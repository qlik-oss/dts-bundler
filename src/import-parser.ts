import ts from "typescript";
import type { FileCollector } from "./file-collector.js";
import type { TypeRegistry } from "./registry.js";
import type { ImportInfo } from "./types.js";

export class ImportParser {
  private registry: TypeRegistry;
  private fileCollector: FileCollector;
  private options: { inlineDeclareExternals: boolean };

  constructor(registry: TypeRegistry, fileCollector: FileCollector, options?: { inlineDeclareExternals?: boolean }) {
    this.registry = registry;
    this.fileCollector = fileCollector;
    this.options = { inlineDeclareExternals: options?.inlineDeclareExternals ?? false };
  }

  parseImports(filePath: string, sourceFile: ts.SourceFile): Map<string, ImportInfo> {
    const fileImports = new Map<string, ImportInfo>();

    for (const statement of sourceFile.statements) {
      if (ts.isImportDeclaration(statement)) {
        this.parseImport(statement, filePath, fileImports);
      } else if (ts.isImportEqualsDeclaration(statement)) {
        this.parseImportEquals(statement, filePath, fileImports);
      }
    }

    for (const statement of sourceFile.statements) {
      if (
        ts.isModuleDeclaration(statement) &&
        ts.isStringLiteral(statement.name) &&
        statement.body &&
        ts.isModuleBlock(statement.body)
      ) {
        const moduleName = statement.name.text;
        const shouldParseModuleImports =
          this.fileCollector.shouldInline(moduleName, filePath) || this.options.inlineDeclareExternals;
        if (!shouldParseModuleImports) {
          continue;
        }

        for (const moduleStatement of statement.body.statements) {
          if (ts.isImportDeclaration(moduleStatement)) {
            this.parseImport(moduleStatement, filePath, fileImports);
          } else if (ts.isImportEqualsDeclaration(moduleStatement)) {
            this.parseImportEquals(moduleStatement, filePath, fileImports);
          }
        }
      }
    }

    return fileImports;
  }

  private parseImport(statement: ts.ImportDeclaration, filePath: string, fileImports: Map<string, ImportInfo>): void {
    const moduleSpecifier = statement.moduleSpecifier;
    if (!ts.isStringLiteral(moduleSpecifier)) {
      return;
    }

    const importPath = moduleSpecifier.text;
    const isTypeOnly = statement.importClause?.isTypeOnly ?? false;

    if (this.fileCollector.shouldInline(importPath, filePath)) {
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
            isTypeOnly,
          });
        }
      }

      if (importClause?.namedBindings && ts.isNamespaceImport(importClause.namedBindings)) {
        const localName = importClause.namedBindings.name.text;
        fileImports.set(localName, {
          originalName: `* as ${localName}`,
          sourceFile: resolvedPath,
          isExternal: false,
          aliasName: null,
          isTypeOnly,
        });
        const key = `${filePath}:${localName}`;
        this.registry.namespaceImports.set(key, {
          namespaceName: localName,
          sourceFile: resolvedPath,
        });
      }

      if (importClause?.name) {
        const localName = importClause.name.text;
        fileImports.set(localName, {
          originalName: "default",
          sourceFile: resolvedPath,
          isExternal: false,
          aliasName: null,
        });
      }
    } else {
      const moduleName = importPath;
      const { typesLibraryName } = this.fileCollector.resolveExternalImport(filePath, moduleName);

      if (statement.importClause?.name) {
        const localName = statement.importClause.name.text;
        fileImports.set(localName, {
          originalName: `default as ${localName}`,
          sourceFile: moduleName,
          isExternal: true,
          aliasName: null,
          isTypeOnly,
        });
        this.registry.registerExternal(moduleName, `default as ${localName}`, isTypeOnly, true, typesLibraryName);
      }

      if (statement.importClause?.namedBindings) {
        if (ts.isNamedImports(statement.importClause.namedBindings)) {
          for (const element of statement.importClause.namedBindings.elements) {
            const localName = element.name.text;
            const originalName = element.propertyName?.text || localName;
            const importName = localName !== originalName ? `${originalName} as ${localName}` : localName;
            fileImports.set(localName, {
              originalName: importName,
              sourceFile: moduleName,
              isExternal: true,
              aliasName: localName !== originalName ? localName : null,
              isTypeOnly,
            });
            this.registry.registerExternal(moduleName, importName, isTypeOnly, false, typesLibraryName);
          }
        } else if (ts.isNamespaceImport(statement.importClause.namedBindings)) {
          const localName = statement.importClause.namedBindings.name.text;
          fileImports.set(localName, {
            originalName: `* as ${localName}`,
            sourceFile: moduleName,
            isExternal: true,
            aliasName: null,
            isTypeOnly,
          });
          this.registry.registerExternal(moduleName, `* as ${localName}`, isTypeOnly, false, typesLibraryName);
        }
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

    const moduleSpecifier = statement.moduleReference.expression;
    if (!ts.isStringLiteral(moduleSpecifier)) {
      return;
    }

    const importPath = moduleSpecifier.text;
    const importName = statement.name.text;
    const isTypeOnly = statement.isTypeOnly;

    if (this.fileCollector.shouldInline(importPath, filePath)) {
      const resolvedPath = this.fileCollector.resolveImport(filePath, importPath);
      if (!resolvedPath) return;

      fileImports.set(importName, {
        originalName: importName,
        sourceFile: resolvedPath,
        isExternal: false,
        aliasName: null,
        isTypeOnly,
      });
    } else {
      fileImports.set(importName, {
        originalName: `= ${importName}`,
        sourceFile: importPath,
        isExternal: true,
        aliasName: null,
        isTypeOnly,
      });
      const { typesLibraryName } = this.fileCollector.resolveExternalImport(filePath, importPath);
      this.registry.registerExternal(importPath, `= ${importName}`, isTypeOnly, false, typesLibraryName);
    }
  }
}
