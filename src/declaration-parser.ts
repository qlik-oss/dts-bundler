import ts from "typescript";
import { FileCollector } from "./file-collector.js";
import type { TypeRegistry } from "./registry.js";
import type { ImportInfo } from "./types.js";
import { TypeDeclaration } from "./types.js";

export class DeclarationParser {
  public importMap: Map<string, Map<string, ImportInfo>>;
  private registry: TypeRegistry;
  private fileCollector: FileCollector;

  constructor(registry: TypeRegistry, fileCollector: FileCollector) {
    this.registry = registry;
    this.fileCollector = fileCollector;
    this.importMap = new Map();
  }

  parseFiles(files: Map<string, { sourceFile: ts.SourceFile; isEntry: boolean }>): void {
    for (const [filePath, { sourceFile, isEntry }] of files.entries()) {
      this.parseFile(filePath, sourceFile, isEntry);
    }

    // Second pass: handle re-exports and resolve export = statements
    for (const [filePath, { sourceFile, isEntry }] of files.entries()) {
      if (isEntry) {
        this.parseReExports(filePath, sourceFile);
      }
      // Resolve export = for all files
      this.resolveExportEquals(filePath, sourceFile);
    }
  }

  private parseFile(filePath: string, sourceFile: ts.SourceFile, isEntry: boolean): void {
    const fileImports = new Map<string, ImportInfo>();
    this.importMap.set(filePath, fileImports);

    for (const statement of sourceFile.statements) {
      if (ts.isImportDeclaration(statement)) {
        this.parseImport(statement, filePath, fileImports);
      } else if (ts.isImportEqualsDeclaration(statement)) {
        this.parseImportEquals(statement, filePath, fileImports);
      }
    }

    for (const statement of sourceFile.statements) {
      if (DeclarationParser.isDeclaration(statement)) {
        this.parseDeclaration(statement, filePath, sourceFile, isEntry);
      } else if (ts.isExportAssignment(statement) && statement.isExportEquals) {
        this.parseExportEquals(statement, filePath);
      }
    }
  }

  private parseImport(statement: ts.ImportDeclaration, filePath: string, fileImports: Map<string, ImportInfo>): void {
    const moduleSpecifier = statement.moduleSpecifier;
    if (!ts.isStringLiteral(moduleSpecifier)) {
      return;
    }

    const importPath = moduleSpecifier.text;
    const isTypeOnly = statement.importClause?.isTypeOnly ?? false;

    if (this.fileCollector.shouldInline(importPath)) {
      const resolvedPath = FileCollector.resolveImport(filePath, importPath);
      if (!resolvedPath) return;

      const importClause = statement.importClause;
      if (importClause?.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
        for (const element of importClause.namedBindings.elements) {
          const localName = element.name.text;
          const originalName = element.propertyName?.text || localName;
          fileImports.set(localName, {
            originalName,
            sourceFile: resolvedPath,
            isExternal: false,
            aliasName: localName !== originalName ? localName : null,
          });
        }
      }
    } else {
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

  private parseImportEquals(
    statement: ts.ImportEqualsDeclaration,
    filePath: string,
    fileImports: Map<string, ImportInfo>,
  ): void {
    if (!ts.isExternalModuleReference(statement.moduleReference)) {
      return;
    }

    const expr = statement.moduleReference.expression;
    if (!ts.isStringLiteral(expr)) {
      return;
    }

    const importPath = expr.text;
    const localName = statement.name.text;

    if (this.fileCollector.shouldInline(importPath)) {
      const resolvedPath = FileCollector.resolveImport(filePath, importPath);
      if (!resolvedPath) return;
      // For import = require(), the local name maps to the entire module
      // We'll resolve the actual declaration later when we know what's exported
      fileImports.set(localName, {
        originalName: localName, // Use the local name as original for now
        sourceFile: resolvedPath,
        isExternal: false,
        aliasName: null,
      });
    } else {
      // Register as external import with special marker for import = require()
      this.registry.registerExternal(importPath, `= ${localName}`, false);
      fileImports.set(localName, {
        originalName: `= ${localName}`,
        sourceFile: importPath,
        isExternal: true,
      });
    }
  }

  private static isDeclaration(statement: ts.Statement): boolean {
    return (
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isEnumDeclaration(statement) ||
      ts.isModuleDeclaration(statement)
    );
  }

  private parseDeclaration(
    statement: ts.Statement,
    filePath: string,
    sourceFile: ts.SourceFile,
    isEntry: boolean,
  ): void {
    const name = DeclarationParser.getDeclarationName(statement);
    if (!name) return;

    const hasExport = DeclarationParser.hasExportModifier(statement);
    const isExported = isEntry ? hasExport : false;

    const declaration = new TypeDeclaration(name, filePath, statement, sourceFile, isExported);

    this.registry.register(declaration);
  }

  private static getDeclarationName(statement: ts.Statement): string | null {
    if (
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isEnumDeclaration(statement) ||
      ts.isModuleDeclaration(statement)
    ) {
      return statement.name?.text ?? null;
    }
    return null;
  }

  private static hasExportModifier(statement: ts.Statement): boolean {
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    return modifiers?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword) ?? false;
  }

  private parseExportEquals(statement: ts.ExportAssignment, filePath: string): void {
    // Handle: export = ClassName
    if (!ts.isIdentifier(statement.expression)) {
      return;
    }

    const exportedName = statement.expression.text;
    const key = `${filePath}:${exportedName}`;
    const declarationId = this.registry.nameIndex.get(key);

    if (declarationId) {
      const declaration = this.registry.getDeclaration(declarationId);
      if (declaration) {
        // Mark as exported since it's being exported via export =
        declaration.wasOriginallyExported = true;
      }
    }
  }

  private parseReExports(filePath: string, sourceFile: ts.SourceFile): void {
    // Handle export { X } from "./module" statements
    for (const statement of sourceFile.statements) {
      if (!ts.isExportDeclaration(statement)) continue;
      if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) continue;

      const importPath = statement.moduleSpecifier.text;
      if (!this.fileCollector.shouldInline(importPath)) continue;

      const resolvedPath = FileCollector.resolveImport(filePath, importPath);
      if (!resolvedPath) continue;

      // Mark the re-exported declarations as exported
      for (const element of statement.exportClause.elements) {
        const exportedName = element.name.text;
        const originalName = element.propertyName?.text || exportedName;

        // Find the declaration in the resolved file
        const key = `${resolvedPath}:${originalName}`;
        const declarationId = this.registry.nameIndex.get(key);
        if (declarationId) {
          const declaration = this.registry.getDeclaration(declarationId);
          if (declaration) {
            declaration.isExported = true;
          }
        }
      }
    }
  }

  private resolveExportEquals(filePath: string, sourceFile: ts.SourceFile): void {
    // Find export = statements in this file
    let exportedName: string | null = null;

    for (const statement of sourceFile.statements) {
      if (ts.isExportAssignment(statement) && statement.isExportEquals) {
        if (ts.isIdentifier(statement.expression)) {
          exportedName = statement.expression.text;
          break;
        }
      }
    }

    if (!exportedName) return;

    // Update all import = require() statements that reference this file
    for (const fileImports of this.importMap.values()) {
      for (const importInfo of fileImports.values()) {
        if (!importInfo.isExternal && importInfo.sourceFile === filePath) {
          // Update the original name to point to the exported declaration
          importInfo.originalName = exportedName;
        }
      }
    }
  }
}
