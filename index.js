#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import pkg from "./package.json" with { type: "json" };

const version = pkg.version || "development";

// ============================================================================
// Phase 1: Type System - Core classes for representing declarations
// ============================================================================

class TypeDeclaration {
  constructor(name, sourceFilePath, node, sourceFileNode, isExported = false) {
    this.id = Symbol(name); // Unique identity
    this.name = name; // Original name in source
    this.normalizedName = name; // Name after conflict resolution
    this.sourceFile = sourceFilePath;
    this.node = node;
    this.sourceFileNode = sourceFileNode; // The TypeScript SourceFile node
    this.isExported = isExported;
    this.dependencies = new Set(); // Set of TypeDeclaration IDs
    this.externalDependencies = new Map(); // Map<moduleName, Set<importName>>
    this.text = null; // Cached text representation
  }

  getText() {
    if (this.text) return this.text;

    // Get full text including JSDoc comments using the original source file
    this.text = this.node.getFullText(this.sourceFileNode).trim();
    return this.text;
  }
}

class ExternalImport {
  constructor(moduleName, importName, isTypeOnly = false) {
    this.moduleName = moduleName;
    this.originalName = importName; // e.g., "Config" or "default as Config"
    this.normalizedName = importName; // After conflict resolution
    this.isTypeOnly = isTypeOnly;
  }
}

// ============================================================================
// Phase 2: Type Registry - Central store for all declarations
// ============================================================================

class TypeRegistry {
  constructor() {
    this.declarations = new Map(); // ID (Symbol) -> TypeDeclaration
    this.declarationsByFile = new Map(); // filePath -> Set<ID>
    this.nameIndex = new Map(); // fileName:typeName -> ID
    this.externalImports = new Map(); // moduleName -> Map<importName, ExternalImport>
  }

  register(declaration) {
    this.declarations.set(declaration.id, declaration);

    // Index by file
    if (!this.declarationsByFile.has(declaration.sourceFile)) {
      this.declarationsByFile.set(declaration.sourceFile, new Set());
    }
    this.declarationsByFile.get(declaration.sourceFile).add(declaration.id);

    // Index by name for lookup
    const key = `${declaration.sourceFile}:${declaration.name}`;
    this.nameIndex.set(key, declaration.id);
  }

  registerExternal(moduleName, importName, isTypeOnly) {
    if (!this.externalImports.has(moduleName)) {
      this.externalImports.set(moduleName, new Map());
    }

    const moduleImports = this.externalImports.get(moduleName);
    if (!moduleImports.has(importName)) {
      moduleImports.set(importName, new ExternalImport(moduleName, importName, isTypeOnly));
    }

    return moduleImports.get(importName);
  }

  lookup(name, fromFile) {
    // Try local lookup first
    const localKey = `${fromFile}:${name}`;
    if (this.nameIndex.has(localKey)) {
      return this.declarations.get(this.nameIndex.get(localKey));
    }
    return null;
  }

  getDeclaration(id) {
    return this.declarations.get(id);
  }

  getAllExported() {
    return Array.from(this.declarations.values()).filter((d) => d.isExported);
  }
}

// ============================================================================
// Phase 3: File Parsing and Collection
// ============================================================================

class FileCollector {
  constructor(options = {}) {
    this.inlinedLibraries = options.inlinedLibraries || [];
    this.processedFiles = new Set();
  }

  shouldInline(importPath) {
    if (importPath.startsWith(".")) {
      return true;
    }
    return this.inlinedLibraries.some((lib) => importPath === lib || importPath.startsWith(`${lib}/`));
  }

  resolveImport(fromFile, importPath) {
    if (!importPath.startsWith(".")) {
      return null;
    }

    const dir = path.dirname(fromFile);
    const resolved = path.resolve(dir, importPath);

    const extensions = [".ts", ".tsx", ".d.ts", "/index.ts", "/index.tsx"];
    for (const ext of extensions) {
      const fullPath = resolved + ext;
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }

    if (fs.existsSync(resolved)) {
      return resolved;
    }

    return null;
  }

  collectFiles(entryFile) {
    const files = new Map(); // filePath -> { content, sourceFile, isEntry }
    const toProcess = [{ file: path.resolve(entryFile), isEntry: true }];

    while (toProcess.length > 0) {
      const { file: filePath, isEntry } = toProcess.shift();

      if (this.processedFiles.has(filePath)) {
        continue;
      }

      this.processedFiles.add(filePath);

      if (!fs.existsSync(filePath)) {
        console.warn(`Warning: File not found: ${filePath}`);
        continue;
      }

      const content = fs.readFileSync(filePath, "utf-8");
      const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);

      files.set(filePath, { content, sourceFile, isEntry });

      // Find imports to process
      for (const statement of sourceFile.statements) {
        if (ts.isImportDeclaration(statement) && statement.moduleSpecifier) {
          const moduleSpecifier = statement.moduleSpecifier;
          if (ts.isStringLiteral(moduleSpecifier)) {
            const importPath = moduleSpecifier.text;
            if (this.shouldInline(importPath)) {
              const resolved = this.resolveImport(filePath, importPath);
              if (resolved) {
                toProcess.push({ file: resolved, isEntry: false });
              }
            }
          }
        } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
          const moduleSpecifier = statement.moduleSpecifier;
          if (ts.isStringLiteral(moduleSpecifier)) {
            const exportPath = moduleSpecifier.text;
            if (this.shouldInline(exportPath)) {
              const resolved = this.resolveImport(filePath, exportPath);
              if (resolved) {
                toProcess.push({ file: resolved, isEntry: false });
              }
            }
          }
        }
      }
    }

    return files;
  }
}

// ============================================================================
// Phase 4: Declaration Parser - Extract type declarations from files
// ============================================================================

class DeclarationParser {
  constructor(registry, fileCollector) {
    this.registry = registry;
    this.fileCollector = fileCollector;
    this.importMap = new Map(); // filePath -> Map<localName, {originalName, sourceFile}>
  }

  parseFiles(files) {
    // First pass: collect all declarations and imports
    for (const [filePath, { sourceFile, isEntry }] of files.entries()) {
      this.parseFile(filePath, sourceFile, isEntry);
    }
  }

  parseFile(filePath, sourceFile, isEntry) {
    const fileImports = new Map(); // localName -> {originalName, sourceFile, isExternal}
    this.importMap.set(filePath, fileImports);

    // Extract imports first
    for (const statement of sourceFile.statements) {
      if (ts.isImportDeclaration(statement)) {
        this.parseImport(statement, filePath, fileImports);
      }
    }

    // Extract declarations
    for (const statement of sourceFile.statements) {
      if (this.isDeclaration(statement)) {
        this.parseDeclaration(statement, filePath, sourceFile, isEntry);
      }
    }
  }

  parseImport(statement, filePath, fileImports) {
    const moduleSpecifier = statement.moduleSpecifier;
    if (!ts.isStringLiteral(moduleSpecifier)) {
      return;
    }

    const importPath = moduleSpecifier.text;
    const isTypeOnly = statement.importClause?.isTypeOnly || false;

    if (this.fileCollector.shouldInline(importPath)) {
      const resolvedPath = this.fileCollector.resolveImport(filePath, importPath);

      // Track named imports
      const importClause = statement.importClause;
      if (importClause?.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
        for (const element of importClause.namedBindings.elements) {
          const localName = element.name.text;
          const originalName = element.propertyName?.text || localName;
          fileImports.set(localName, {
            originalName,
            sourceFile: resolvedPath,
            isExternal: false,
            aliasName: localName !== originalName ? localName : null, // Track if aliased
          });
        }
      }
    } else {
      // External import
      const importClause = statement.importClause;
      if (importClause?.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
        for (const element of importClause.namedBindings.elements) {
          const localName = element.name.text;
          const originalName = element.propertyName?.text || localName;
          const importStr = originalName === localName ? localName : `${originalName} as ${localName}`;

          this.registry.registerExternal(importPath, importStr, isTypeOnly);
          fileImports.set(localName, {
            originalName: importStr,
            sourceFile: importPath,
            isExternal: true,
          });
        }
      }

      // Handle namespace imports
      if (importClause?.namedBindings && ts.isNamespaceImport(importClause.namedBindings)) {
        const localName = importClause.namedBindings.name.text;
        const importStr = `* as ${localName}`;
        this.registry.registerExternal(importPath, importStr, isTypeOnly);
        fileImports.set(localName, {
          originalName: importStr,
          sourceFile: importPath,
          isExternal: true,
        });
      }

      // Handle default imports
      if (importClause?.name) {
        const localName = importClause.name.text;
        const importStr = `default as ${localName}`;
        this.registry.registerExternal(importPath, importStr, isTypeOnly);
        fileImports.set(localName, {
          originalName: importStr,
          sourceFile: importPath,
          isExternal: true,
        });
      }
    }
  }

  isDeclaration(statement) {
    return (
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isEnumDeclaration(statement) ||
      ts.isModuleDeclaration(statement)
    );
  }

  parseDeclaration(statement, filePath, sourceFile, isEntry) {
    const name = this.getDeclarationName(statement);
    if (!name) return;

    // A declaration is exported if:
    // 1. It has export keyword in the entry file, OR
    // 2. It's in a non-entry file (all types from imported files are available)
    const hasExport = this.hasExportModifier(statement);
    const isExported = isEntry ? hasExport : false;

    const declaration = new TypeDeclaration(name, filePath, statement, sourceFile, isExported);

    this.registry.register(declaration);
  }

  getDeclarationName(statement) {
    if (
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isEnumDeclaration(statement) ||
      ts.isModuleDeclaration(statement)
    ) {
      return statement.name?.text;
    }
    return null;
  }

  hasExportModifier(statement) {
    return statement.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword);
  }
}

// ============================================================================
// Phase 5: Dependency Analyzer - Build dependency relationships
// ============================================================================

class DependencyAnalyzer {
  constructor(registry, importMap) {
    this.registry = registry;
    this.importMap = importMap;
  }

  analyze() {
    // First, track import aliases from entry file to set preferred names
    this.trackEntryFileAliases();

    // Then analyze all dependencies
    for (const declaration of this.registry.declarations.values()) {
      this.analyzeDependencies(declaration);
    }
  }

  trackEntryFileAliases() {
    // Find the entry file(s) - files where declarations are exported
    const entryFiles = new Set();
    for (const declaration of this.registry.declarations.values()) {
      if (declaration.isExported) {
        entryFiles.add(declaration.sourceFile);
      }
    }

    // For each entry file, check its imports and set preferred names
    for (const entryFile of entryFiles) {
      const fileImports = this.importMap.get(entryFile);
      if (!fileImports) continue;

      for (const [, importInfo] of fileImports.entries()) {
        if (!importInfo.isExternal && importInfo.aliasName) {
          // This type was imported with an alias - find the declaration and set its preferred name
          const key = `${importInfo.sourceFile}:${importInfo.originalName}`;
          const declId = this.registry.nameIndex.get(key);
          if (declId) {
            const decl = this.registry.getDeclaration(declId);
            if (decl) {
              // Set the normalized name to the alias used in the entry file
              decl.normalizedName = importInfo.aliasName;
            }
          }
        }
      }
    }
  }

  analyzeDependencies(declaration) {
    const fileImports = this.importMap.get(declaration.sourceFile) || new Map();
    const references = new Set();

    this.extractTypeReferences(declaration.node, references);

    for (const refName of references) {
      // Check if it's an import
      const importInfo = fileImports.get(refName);

      if (importInfo) {
        if (importInfo.isExternal) {
          // External dependency
          const [moduleName] = importInfo.sourceFile.split(":");
          if (!declaration.externalDependencies.has(moduleName)) {
            declaration.externalDependencies.set(moduleName, new Set());
          }
          declaration.externalDependencies.get(moduleName).add(refName);
        } else if (importInfo.sourceFile) {
          // Internal dependency - resolve to declaration
          const key = `${importInfo.sourceFile}:${importInfo.originalName}`;
          const depId = this.registry.nameIndex.get(key);
          if (depId) {
            declaration.dependencies.add(depId);
          }
        }
      } else {
        // Local reference in same file
        const localKey = `${declaration.sourceFile}:${refName}`;
        const localId = this.registry.nameIndex.get(localKey);
        if (localId && localId !== declaration.id) {
          declaration.dependencies.add(localId);
        }
      }
    }
  }

  extractTypeReferences(node, references) {
    if (ts.isTypeReferenceNode(node)) {
      const typeName = node.typeName;
      if (ts.isIdentifier(typeName)) {
        references.add(typeName.text);
      } else if (ts.isQualifiedName(typeName)) {
        this.extractQualifiedName(typeName, references);
      }
    }

    // Handle heritage clauses (extends)
    if ((ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node)) && node.heritageClauses) {
      for (const clause of node.heritageClauses) {
        for (const type of clause.types) {
          if (type.expression && ts.isIdentifier(type.expression)) {
            references.add(type.expression.text);
          }
        }
      }
    }

    node.forEachChild((child) => this.extractTypeReferences(child, references));
  }

  extractQualifiedName(qualifiedName, references) {
    let current = qualifiedName;
    while (ts.isQualifiedName(current)) {
      if (ts.isIdentifier(current.right)) {
        references.add(current.right.text);
      }
      current = current.left;
    }
    if (ts.isIdentifier(current)) {
      references.add(current.text);
    }
  }
}

// ============================================================================
// Phase 6: Name Normalizer - Resolve naming conflicts
// ============================================================================

class NameNormalizer {
  constructor(registry) {
    this.registry = registry;
    this.nameCounter = new Map(); // baseName -> count
  }

  normalize() {
    // Group declarations by their current normalized name
    const byName = new Map(); // name -> Array<TypeDeclaration>

    for (const declaration of this.registry.declarations.values()) {
      const name = declaration.normalizedName; // Use normalizedName which may already be set by aliases
      if (!byName.has(name)) {
        byName.set(name, []);
      }
      byName.get(name).push(declaration);
    }

    // Resolve conflicts only for declarations that don't already have unique names
    for (const [name, declarations] of byName.entries()) {
      if (declarations.length > 1) {
        // Keep first as-is, rename others
        for (let i = 1; i < declarations.length; i++) {
          const counter = this.nameCounter.get(name) || 1;
          this.nameCounter.set(name, counter + 1);
          declarations[i].normalizedName = `${name}_${counter}`;
        }
      }
    }

    // Normalize external imports
    this.normalizeExternalImports();
  }

  normalizeExternalImports() {
    const importNameCounts = new Map(); // importName -> Array<ExternalImport>

    // Group by import name
    for (const moduleImports of this.registry.externalImports.values()) {
      for (const externalImport of moduleImports.values()) {
        const name = this.extractImportName(externalImport.originalName);
        if (!importNameCounts.has(name)) {
          importNameCounts.set(name, []);
        }
        importNameCounts.get(name).push(externalImport);
      }
    }

    // Resolve conflicts
    for (const [name, imports] of importNameCounts.entries()) {
      if (imports.length > 1) {
        for (let i = 1; i < imports.length; i++) {
          const counter = this.nameCounter.get(name) || 1;
          this.nameCounter.set(name, counter + 1);
          const newName = `${name}_${counter}`;

          // Update the normalized name based on original format
          if (imports[i].originalName.startsWith("default as ")) {
            imports[i].normalizedName = `default as ${newName}`;
          } else if (imports[i].originalName.startsWith("* as ")) {
            imports[i].normalizedName = `* as ${newName}`;
          } else if (imports[i].originalName.includes(" as ")) {
            const [original] = imports[i].originalName.split(" as ");
            imports[i].normalizedName = `${original} as ${newName}`;
          } else {
            imports[i].normalizedName = `${imports[i].originalName} as ${newName}`;
          }
        }
      }
    }
  }

  extractImportName(importStr) {
    if (importStr.startsWith("default as ")) {
      return importStr.replace("default as ", "");
    }
    if (importStr.startsWith("* as ")) {
      return importStr.replace("* as ", "");
    }
    if (importStr.includes(" as ")) {
      const parts = importStr.split(" as ");
      return parts[1].trim();
    }
    return importStr;
  }
}

// ============================================================================
// Phase 7: Tree Shaker - Mark used declarations
// ============================================================================

class TreeShaker {
  constructor(registry) {
    this.registry = registry;
    this.used = new Set(); // Set of used declaration IDs
    this.usedExternals = new Set(); // Set of used external import keys
  }

  shake() {
    // Start from all exported declarations
    const exported = this.registry.getAllExported();

    for (const declaration of exported) {
      this.markUsed(declaration.id);
    }

    return {
      declarations: this.used,
      externalImports: this.collectUsedExternalImports(),
    };
  }

  markUsed(declarationId) {
    if (this.used.has(declarationId)) {
      return; // Already processed
    }

    this.used.add(declarationId);

    const declaration = this.registry.getDeclaration(declarationId);
    if (!declaration) return;

    // Mark all dependencies as used
    for (const depId of declaration.dependencies) {
      this.markUsed(depId);
    }

    // Track external dependencies
    for (const [moduleName, importNames] of declaration.externalDependencies.entries()) {
      for (const importName of importNames) {
        this.usedExternals.add(`${moduleName}:${importName}`);
      }
    }
  }

  collectUsedExternalImports() {
    const result = new Map(); // moduleName -> Set<ExternalImport>

    for (const [moduleName, moduleImports] of this.registry.externalImports.entries()) {
      for (const [importName, externalImport] of moduleImports.entries()) {
        const key = `${moduleName}:${importName}`;
        if (this.usedExternals.has(key)) {
          if (!result.has(moduleName)) {
            result.set(moduleName, new Set());
          }
          result.get(moduleName).add(externalImport);
        }
      }
    }

    return result;
  }
}

// ============================================================================
// Phase 8: Output Generator - Generate bundled output using AST transforms
// ============================================================================

class OutputGenerator {
  constructor(registry, usedDeclarations, usedExternals) {
    this.registry = registry;
    this.usedDeclarations = usedDeclarations;
    this.usedExternals = usedExternals;
    this.nameMap = new Map(); // original name -> normalized name (for replacements)
  }

  generate() {
    const lines = [];

    // Header
    lines.push(`// Generated by @qlik/dts-bundler@${version}\n`);

    // External imports
    if (this.usedExternals.size > 0) {
      lines.push(...this.generateExternalImports());
      lines.push("");
    }

    // Build name map for replacements
    this.buildNameMap();

    // Type declarations
    lines.push(...this.generateDeclarations());

    // Ensure module export
    const hasExports = lines.some((line) => line.trim().startsWith("export "));
    if (!hasExports) {
      lines.push("\nexport {};");
    }

    return lines.join("\n");
  }

  buildNameMap() {
    for (const id of this.usedDeclarations) {
      const declaration = this.registry.getDeclaration(id);
      if (declaration && declaration.name !== declaration.normalizedName) {
        const key = `${declaration.sourceFile}:${declaration.name}`;
        this.nameMap.set(key, declaration.normalizedName);
      }
    }
  }

  generateExternalImports() {
    const lines = [];
    const sortedModules = Array.from(this.usedExternals.keys()).sort();

    for (const moduleName of sortedModules) {
      const imports = Array.from(this.usedExternals.get(moduleName));
      if (imports.length === 0) continue;

      const isTypeOnly = imports.every((imp) => imp.isTypeOnly);
      const typePrefix = isTypeOnly ? "type " : "";

      const hasNamespace = imports.some((imp) => imp.normalizedName.startsWith("* as "));

      if (hasNamespace) {
        const importList = imports.map((imp) => imp.normalizedName).sort();
        lines.push(`import ${typePrefix}${importList.join(", ")} from "${moduleName}";`);
      } else {
        const importList = imports
          .map((imp) => imp.normalizedName)
          .filter((name) => !name.startsWith("default as "))
          .sort();

        if (importList.length > 0) {
          lines.push(`import ${typePrefix}{ ${importList.join(", ")} } from "${moduleName}";`);
        }
      }
    }

    return lines;
  }

  generateDeclarations() {
    const lines = [];

    // Topological sort to ensure dependencies come before declarations that use them
    const sorted = this.topologicalSort();

    for (const declaration of sorted) {
      let text = declaration.getText();

      // Remove export keyword if not from entry file
      if (!declaration.isExported && text.includes("export ")) {
        text = text.replace(/^((?:\/\*\*[\s\S]*?\*\/\s*)?)export\s+/, "$1");
      }

      // Replace renamed types
      text = this.replaceRenamedReferences(text, declaration);

      lines.push(text);
    }

    return lines;
  }

  topologicalSort() {
    const sorted = [];
    const visited = new Set();
    const visiting = new Set();

    const visit = (id) => {
      if (visited.has(id)) return;
      if (visiting.has(id)) {
        // Circular dependency - just skip to avoid infinite loop
        return;
      }

      visiting.add(id);
      const declaration = this.registry.getDeclaration(id);

      if (declaration) {
        // Visit dependencies first
        for (const depId of declaration.dependencies) {
          if (this.usedDeclarations.has(depId)) {
            visit(depId);
          }
        }

        visiting.delete(id);
        visited.add(id);
        sorted.push(declaration);
      }
    };

    // Visit all used declarations, prioritizing exported ones last
    const used = Array.from(this.usedDeclarations);
    const exported = used.filter((id) => {
      const decl = this.registry.getDeclaration(id);
      return decl && decl.isExported;
    });
    const nonExported = used.filter((id) => {
      const decl = this.registry.getDeclaration(id);
      return decl && !decl.isExported;
    });

    // Process non-exported first (dependencies), then exported
    for (const id of nonExported) {
      visit(id);
    }
    for (const id of exported) {
      visit(id);
    }

    return sorted;
  }

  replaceRenamedReferences(text, declaration) {
    let result = text;

    // Replace the declaration's own name if renamed
    if (declaration.name !== declaration.normalizedName) {
      const regex = new RegExp(`\\b(type|interface|class|enum)\\s+${declaration.name}\\b`, "g");
      result = result.replace(regex, `$1 ${declaration.normalizedName}`);
    }

    // Replace references to renamed dependencies
    for (const depId of declaration.dependencies) {
      const depDecl = this.registry.getDeclaration(depId);
      if (depDecl && depDecl.name !== depDecl.normalizedName) {
        const regex = new RegExp(`\\b${depDecl.name}\\b(?![_])`, "g");
        result = result.replace(regex, depDecl.normalizedName);
      }
    }

    // Replace external import references
    for (const [moduleName, importNames] of declaration.externalDependencies.entries()) {
      const moduleImports = this.registry.externalImports.get(moduleName);
      if (!moduleImports) continue;

      for (const importName of importNames) {
        const externalImport = moduleImports.get(importName);
        if (!externalImport) continue;

        const originalName = this.extractImportName(externalImport.originalName);
        const normalizedName = this.extractImportName(externalImport.normalizedName);

        if (originalName !== normalizedName) {
          const regex = new RegExp(`\\b${originalName}\\b(?![_])`, "g");
          result = result.replace(regex, normalizedName);
        }
      }
    }

    return result;
  }

  extractImportName(importStr) {
    if (importStr.startsWith("default as ")) {
      return importStr.replace("default as ", "");
    }
    if (importStr.startsWith("* as ")) {
      return importStr.replace("* as ", "");
    }
    if (importStr.includes(" as ")) {
      const parts = importStr.split(" as ");
      return parts[1].trim();
    }
    return importStr;
  }
}

// ============================================================================
// Main Bundle Function - Orchestrates all phases
// ============================================================================

function bundle(entry, inlinedLibraries = []) {
  const entryFile = path.resolve(entry);

  if (!fs.existsSync(entryFile)) {
    throw new Error(`Entry file ${entryFile} does not exist`);
  }

  // Phase 1: Collect all files
  const collector = new FileCollector({ inlinedLibraries });
  const files = collector.collectFiles(entryFile);

  // Phase 2: Create registry and parse declarations
  const registry = new TypeRegistry();
  const parser = new DeclarationParser(registry, collector);
  parser.parseFiles(files);

  // Phase 3: Analyze dependencies
  const analyzer = new DependencyAnalyzer(registry, parser.importMap);
  analyzer.analyze();

  // Phase 4: Normalize names (resolve conflicts)
  const normalizer = new NameNormalizer(registry);
  normalizer.normalize();

  // Phase 5: Tree shake
  const shaker = new TreeShaker(registry);
  const { declarations: usedDeclarations, externalImports: usedExternals } = shaker.shake();

  // Phase 6: Generate output
  const generator = new OutputGenerator(registry, usedDeclarations, usedExternals);
  return generator.generate();
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Bundle TypeScript declaration files
 * @param {Object} options - Bundling options
 * @param {string} options.entry - Entry TypeScript file path
 * @param {string[]} [options.inlinedLibraries=[]] - Array of library names to inline
 * @returns {string} The bundled TypeScript declaration content
 */
export function bundleDts(options) {
  const { entry, inlinedLibraries = [] } = options;

  if (!entry) {
    throw new Error("The 'entry' option is required");
  }

  return bundle(entry, inlinedLibraries);
}

// ============================================================================
// CLI Support (same as original)
// ============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    entry: null,
    output: null,
    inlinedLibraries: [],
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-e" || arg === "--entry") {
      options.entry = args[++i];
    } else if (arg === "-o" || arg === "--output") {
      options.output = args[++i];
    } else if (arg === "-i" || arg === "--inlinedLibraries") {
      const libs = args[++i];
      options.inlinedLibraries = libs
        ? libs
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
    } else if (arg === "-h" || arg === "--help") {
      console.log("TypeScript Type Bundler v2");
      console.log("\nUsage: bundle-types -e <entry> -o <output> [-i <inlinedLibraries>]");
      console.log("\nOptions:");
      console.log("  -e, --entry <file>              Entry TypeScript file");
      console.log("  -o, --output <file>             Output bundled file");
      console.log("  -i, --inlinedLibraries <list>   Comma-separated libraries to inline");
      console.log("  -h, --help                      Show this help message");
      process.exit(0);
    }
  }

  if (!options.entry || !options.output) {
    console.error("Error: Missing required arguments");
    console.error("\nUsage: bundle-types -e <entry> -o <output> [-i <inlinedLibraries>]");
    process.exit(1);
  }

  return options;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseArgs();

  console.log(`Bundling types from ${path.resolve(options.entry)}...`);

  try {
    const bundledContent = bundleDts({
      entry: options.entry,
      inlinedLibraries: options.inlinedLibraries,
    });

    const outputPath = path.resolve(options.output);
    const outputDir = path.dirname(outputPath);

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, bundledContent, "utf-8");
    console.log(`✓ Types bundled successfully to ${outputPath}`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}
