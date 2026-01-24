import ts from "typescript";
import type { FileCollector } from "./file-collector.js";
import type { TypeRegistry } from "./registry.js";
import type { ImportInfo } from "./types.js";
import { TypeDeclaration } from "./types.js";

export class DeclarationParser {
  public importMap: Map<string, Map<string, ImportInfo>>;
  public entryExportEquals: ts.ExportAssignment | null = null;
  public entryExportDefaultName: string | null = null;
  public entryExportDefault: ts.ExportAssignment | null = null;
  private registry: TypeRegistry;
  private fileCollector: FileCollector;
  private options: { inlineDeclareGlobals: boolean };

  constructor(registry: TypeRegistry, fileCollector: FileCollector, options?: { inlineDeclareGlobals?: boolean }) {
    this.registry = registry;
    this.fileCollector = fileCollector;
    this.importMap = new Map();
    this.options = { inlineDeclareGlobals: options?.inlineDeclareGlobals ?? false };
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
      this.resolveExportEquals(filePath, sourceFile, isEntry);
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
        // Handle ambient module declarations specially (those with string literal names like 'fake-fs')
        if (
          ts.isModuleDeclaration(statement) &&
          ts.isStringLiteral(statement.name) &&
          statement.body &&
          ts.isModuleBlock(statement.body)
        ) {
          this.parseAmbientModule(statement, filePath, sourceFile);
        } else {
          this.parseDeclaration(statement, filePath, sourceFile, isEntry);
        }
      } else if (ts.isExportAssignment(statement) && statement.isExportEquals) {
        // Store export = from entry file
        if (isEntry) {
          this.entryExportEquals = statement;
        }
        this.parseExportEquals(statement, filePath, isEntry);
      } else if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
        // Handle export default
        if (isEntry) {
          this.entryExportDefault = statement;
          // If the export default has an embedded declaration, parse it
          const expression = statement.expression;
          if (
            ts.isClassDeclaration(expression) ||
            ts.isFunctionDeclaration(expression) ||
            ts.isInterfaceDeclaration(expression) ||
            ts.isEnumDeclaration(expression)
          ) {
            // Parse the embedded declaration
            const name = expression.name?.text;
            if (name) {
              const hasExport = DeclarationParser.hasExportModifier(expression);
              const isExported = true; // Always mark as exported since it's in entry file
              const wasOriginallyExported = hasExport;

              const declaration = new TypeDeclaration(
                name,
                filePath,
                expression,
                sourceFile,
                isExported,
                wasOriginallyExported,
              );
              declaration.isExportedAsDefault = true;

              this.registry.register(declaration);
            }
          } else if (ts.isIdentifier(expression)) {
            // Reference to an existing declaration
            const exportedName = expression.text;
            const key = `${filePath}:${exportedName}`;
            const declarationId = this.registry.nameIndex.get(key);
            if (declarationId) {
              const declaration = this.registry.getDeclaration(declarationId);
              if (declaration) {
                declaration.isExportedAsDefault = true;
                declaration.isExported = true;
              }
            }
          }
        }
      }
    }
  }

  private parseAmbientModule(moduleDecl: ts.ModuleDeclaration, filePath: string, sourceFile: ts.SourceFile): void {
    if (!moduleDecl.body || !ts.isModuleBlock(moduleDecl.body)) {
      return;
    }

    // Only parse ambient modules that should be inlined
    const moduleName = moduleDecl.name.text;
    if (!this.fileCollector.shouldInline(moduleName)) {
      return;
    }

    // Parse imports inside the ambient module
    const fileImports = this.importMap.get(filePath);
    if (fileImports) {
      for (const statement of moduleDecl.body.statements) {
        if (ts.isImportDeclaration(statement)) {
          this.parseImport(statement, filePath, fileImports);
        }
      }
    }

    // Parse all declarations inside the ambient module
    // Treat them as if they're top-level with exports
    for (const statement of moduleDecl.body.statements) {
      if (DeclarationParser.isDeclaration(statement)) {
        const name = DeclarationParser.getDeclarationName(statement);
        if (!name) continue;

        // Check if this declaration has the export keyword
        const hasExport = DeclarationParser.hasExportModifier(statement);

        // In ambient modules, exported declarations should be treated as exports
        const declaration = new TypeDeclaration(name, filePath, statement, sourceFile, hasExport);
        this.registry.register(declaration);
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
      const resolvedPath = this.fileCollector.resolveImport(filePath, importPath);
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

      // Handle import * as namespace from local files
      if (importClause?.namedBindings && ts.isNamespaceImport(importClause.namedBindings)) {
        const localName = importClause.namedBindings.name.text;
        fileImports.set(localName, {
          originalName: `* as ${localName}`,
          sourceFile: resolvedPath,
          isExternal: false,
          aliasName: null,
        });
        // Register the namespace import in the registry
        const key = `${filePath}:${localName}`;
        this.registry.namespaceImports.set(key, {
          namespaceName: localName,
          sourceFile: resolvedPath,
        });
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
      const resolvedPath = this.fileCollector.resolveImport(filePath, importPath);
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
      ts.isModuleDeclaration(statement) ||
      ts.isVariableStatement(statement) ||
      ts.isFunctionDeclaration(statement)
    );
  }

  private parseDeclaration(
    statement: ts.Statement,
    filePath: string,
    sourceFile: ts.SourceFile,
    isEntry: boolean,
  ): void {
    if (DeclarationParser.isDeclareGlobal(statement) && !this.options.inlineDeclareGlobals) {
      return;
    }

    const name = DeclarationParser.getDeclarationName(statement);
    if (!name) return;

    const hasExport = DeclarationParser.hasExportModifier(statement);
    const hasDefaultExport = DeclarationParser.hasDefaultModifier(statement);
    const isDeclareGlobal = DeclarationParser.isDeclareGlobal(statement);
    let isExported = isEntry ? hasExport : false;

    // For declarations from inlined libraries, preserve their original export status
    let wasOriginallyExported = this.fileCollector.isFromInlinedLibrary(filePath) ? hasExport : isExported;

    if (isDeclareGlobal && this.options.inlineDeclareGlobals) {
      isExported = true;
      wasOriginallyExported = true;
    }

    const declaration = new TypeDeclaration(name, filePath, statement, sourceFile, isExported, wasOriginallyExported);

    if (isEntry && hasDefaultExport) {
      declaration.isExportedAsDefault = true;
      declaration.isExported = true;
      this.entryExportDefaultName = name;
    }

    this.registry.register(declaration);
  }

  private static getDeclarationName(statement: ts.Statement): string | null {
    if (
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isEnumDeclaration(statement) ||
      ts.isModuleDeclaration(statement) ||
      ts.isFunctionDeclaration(statement)
    ) {
      return statement.name?.text ?? null;
    }

    if (ts.isVariableStatement(statement)) {
      // Get the first variable declaration name
      const declaration = statement.declarationList.declarations[0];
      if (ts.isIdentifier(declaration.name)) {
        return declaration.name.text;
      }
    }

    return null;
  }

  private static hasExportModifier(statement: ts.Statement): boolean {
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    return modifiers?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword) ?? false;
  }

  private static hasDefaultModifier(statement: ts.Statement): boolean {
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    return modifiers?.some((mod) => mod.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
  }

  private static isDeclareGlobal(statement: ts.Statement): statement is ts.ModuleDeclaration {
    return ts.isModuleDeclaration(statement) && (statement.flags & ts.NodeFlags.GlobalAugmentation) !== 0;
  }

  private parseExportEquals(statement: ts.ExportAssignment, filePath: string, isEntry: boolean): void {
    // Handle: export = ClassName
    if (!ts.isIdentifier(statement.expression)) {
      return;
    }

    const exportedName = statement.expression.text;

    // First, check if this is an imported name
    const fileImports = this.importMap.get(filePath);
    const importInfo = fileImports?.get(exportedName);

    let key: string;
    let targetFilePath: string;
    let targetName: string;

    if (importInfo && !importInfo.isExternal && importInfo.sourceFile) {
      // It's an import, resolve to the actual declaration
      targetFilePath = importInfo.sourceFile;
      targetName = importInfo.originalName;
      key = `${targetFilePath}:${targetName}`;
    } else {
      // It's a local declaration
      targetFilePath = filePath;
      targetName = exportedName;
      key = `${filePath}:${exportedName}`;
    }

    const declarationId = this.registry.nameIndex.get(key);

    if (declarationId) {
      const declaration = this.registry.getDeclaration(declarationId);
      if (declaration) {
        // When exported via export = from entry, mark it so we know to suppress export keyword
        // but keep isExported=true so tree shaker includes it
        if (isEntry) {
          declaration.isExported = true;
          declaration.isExportEquals = true;
        } else {
          // For non-entry files, mark as exported since it's being exported via export =
          declaration.wasOriginallyExported = true;
        }
      }
    }
  }

  private parseReExports(filePath: string, sourceFile: ts.SourceFile): void {
    // Handle export { X } from "./module" statements and local export lists
    for (const statement of sourceFile.statements) {
      if (!ts.isExportDeclaration(statement)) continue;
      if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) continue;

      if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
        const importPath = statement.moduleSpecifier.text;
        if (!this.fileCollector.shouldInline(importPath)) continue;

        const resolvedPath = this.fileCollector.resolveImport(filePath, importPath);
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
      } else {
        // export { X } (local export list) - resolve through imports if needed
        const fileImports = this.importMap.get(filePath);

        for (const element of statement.exportClause.elements) {
          const exportedName = element.name.text;
          const originalName = element.propertyName?.text || exportedName;

          const importInfo = fileImports?.get(originalName);
          let key: string;
          if (importInfo && !importInfo.isExternal && importInfo.sourceFile) {
            key = `${importInfo.sourceFile}:${importInfo.originalName}`;
          } else {
            key = `${filePath}:${originalName}`;
          }

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
  }

  private resolveExportEquals(
    filePath: string,
    sourceFile: ts.SourceFile,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    isEntry: boolean,
  ): void {
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
