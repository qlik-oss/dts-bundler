import ts from "typescript";
import { getDeclarationName, hasDefaultModifier, hasExportModifier, isDeclaration } from "./declaration-utils.js";
import type { FileCollector } from "./file-collector.js";
import type { TypeRegistry } from "./registry.js";
import { ExportKind, TypeDeclaration, type ExportInfo } from "./types.js";

export class ExportResolver {
  private registry: TypeRegistry;
  private fileCollector: FileCollector;

  constructor(registry: TypeRegistry, fileCollector: FileCollector) {
    this.registry = registry;
    this.fileCollector = fileCollector;
  }

  handleExportAssignments(
    filePath: string,
    sourceFile: ts.SourceFile,
    isEntry: boolean,
    importMap: Map<string, Map<string, { originalName: string; sourceFile: string | null; isExternal: boolean }>>,
    onEntryExportEquals: (statement: ts.ExportAssignment) => void,
    onEntryExportDefault: (statement: ts.ExportAssignment) => void,
  ): void {
    for (const statement of sourceFile.statements) {
      if (!ts.isExportAssignment(statement)) {
        continue;
      }

      if (statement.isExportEquals) {
        if (isEntry) {
          onEntryExportEquals(statement);
        }
        this.parseExportEquals(statement, filePath, isEntry, importMap);
        continue;
      }

      if (isEntry) {
        onEntryExportDefault(statement);
        this.parseExportDefault(statement, filePath);
      }
    }
  }

  collectDirectNamespaceExports(filePath: string, sourceFile: ts.SourceFile): void {
    for (const statement of sourceFile.statements) {
      if (!ts.isExportDeclaration(statement)) continue;
      if (!statement.exportClause || !ts.isNamespaceExport(statement.exportClause)) continue;
      if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;

      const exportName = statement.exportClause.name.text;
      const importPath = statement.moduleSpecifier.text;

      if (this.fileCollector.shouldInline(importPath)) {
        const resolvedPath = this.fileCollector.resolveImport(filePath, importPath);
        if (!resolvedPath) continue;
        this.registry.registerNamespaceExport(
          filePath,
          {
            name: exportName,
            targetFile: resolvedPath,
          },
          false,
        );
      } else {
        const importName = `* as ${exportName}`;
        this.registry.registerExternal(importPath, importName, statement.isTypeOnly);
        this.registry.registerNamespaceExport(
          filePath,
          {
            name: exportName,
            externalModule: importPath,
            externalImportName: importName,
          },
          false,
        );
      }
    }
  }

  collectFileExports(
    filePath: string,
    sourceFile: ts.SourceFile,
    importMap: Map<
      string,
      Map<string, { originalName: string; sourceFile: string | null; isExternal: boolean; aliasName?: string | null }>
    >,
    isEntry: boolean,
  ): void {
    const fileImports = importMap.get(filePath);

    for (const statement of sourceFile.statements) {
      if (isDeclaration(statement) && hasExportModifier(statement)) {
        if (ts.isVariableStatement(statement)) {
          for (const declaration of statement.declarationList.declarations) {
            if (ts.isIdentifier(declaration.name)) {
              this.registry.registerExportedName(filePath, { name: declaration.name.text });
            }
          }
          continue;
        }

        const name = getDeclarationName(statement);
        if (name) {
          this.registry.registerExportedName(filePath, { name });
        }
        continue;
      }

      if (!ts.isExportDeclaration(statement)) continue;
      if (!statement.exportClause) continue;

      if (ts.isNamespaceExport(statement.exportClause)) {
        const exportName = statement.exportClause.name.text;
        const existingNamespaceInfo = this.registry.getNamespaceExportInfo(filePath, exportName);
        if (!existingNamespaceInfo) {
          if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
            const importPath = statement.moduleSpecifier.text;
            if (this.fileCollector.shouldInline(importPath)) {
              const resolvedPath = this.fileCollector.resolveImport(filePath, importPath);
              if (resolvedPath) {
                this.registry.registerNamespaceExport(filePath, { name: exportName, targetFile: resolvedPath });
              }
            } else {
              const importName = `* as ${exportName}`;
              this.registry.registerExternal(importPath, importName, statement.isTypeOnly);
              this.registry.registerNamespaceExport(filePath, {
                name: exportName,
                externalModule: importPath,
                externalImportName: importName,
              });
            }
          } else {
            this.registry.registerExportedName(filePath, { name: exportName });
          }
        } else {
          this.registry.registerExportedName(filePath, {
            name: exportName,
            externalModule: existingNamespaceInfo.externalModule,
            externalImportName: existingNamespaceInfo.externalImportName,
          });
        }

        if (isEntry) {
          this.registry.registerEntryNamespaceExport(filePath, exportName);
        }
        continue;
      }

      if (!ts.isNamedExports(statement.exportClause)) continue;

      if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
        const importPath = statement.moduleSpecifier.text;
        const isInline = this.fileCollector.shouldInline(importPath);
        const resolvedPath = isInline ? this.fileCollector.resolveImport(filePath, importPath) : null;

        for (const element of statement.exportClause.elements) {
          const exportedName = element.name.text;
          const originalName = element.propertyName?.text || exportedName;

          if (isInline && resolvedPath) {
            const namespaceInfo = this.registry.getNamespaceExportInfo(resolvedPath, originalName);
            if (namespaceInfo) {
              this.registry.registerNamespaceExport(filePath, {
                name: exportedName,
                targetFile: namespaceInfo.targetFile,
                externalModule: namespaceInfo.externalModule,
                externalImportName: namespaceInfo.externalImportName,
              });
              if (isEntry) {
                this.registry.registerEntryNamespaceExport(filePath, exportedName);
              }
            } else {
              this.registry.registerExportedName(filePath, { name: exportedName });
            }
          } else if (!isInline) {
            const importName = originalName === exportedName ? originalName : `${originalName} as ${exportedName}`;
            this.registry.registerExternal(importPath, importName, statement.isTypeOnly);
            this.registry.registerExportedName(filePath, {
              name: exportedName,
              externalModule: importPath,
              externalImportName: importName,
            });
          }
        }
        continue;
      }

      for (const element of statement.exportClause.elements) {
        const exportedName = element.name.text;
        const originalName = element.propertyName?.text || exportedName;
        const importInfo = fileImports?.get(originalName);

        if (importInfo && importInfo.isExternal && importInfo.sourceFile) {
          this.registry.registerExportedName(filePath, {
            name: exportedName,
            externalModule: importInfo.sourceFile,
            externalImportName: importInfo.originalName,
          });
        } else {
          this.registry.registerExportedName(filePath, { name: exportedName });
        }

        const namespaceInfo = this.registry.getNamespaceExportInfo(filePath, originalName);
        if (namespaceInfo && exportedName !== originalName) {
          this.registry.registerNamespaceExport(filePath, {
            name: exportedName,
            targetFile: namespaceInfo.targetFile,
            externalModule: namespaceInfo.externalModule,
            externalImportName: namespaceInfo.externalImportName,
          });
          if (isEntry) {
            this.registry.registerEntryNamespaceExport(filePath, exportedName);
          }
        }
      }
    }
  }

  parseReExports(
    filePath: string,
    sourceFile: ts.SourceFile,
    importMap: Map<
      string,
      Map<string, { originalName: string; sourceFile: string | null; isExternal: boolean; aliasName?: string | null }>
    >,
    onEntryExportDefaultName?: (name: string) => void,
  ): void {
    for (const statement of sourceFile.statements) {
      if (!ts.isExportDeclaration(statement)) continue;
      if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) continue;

      if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
        const importPath = statement.moduleSpecifier.text;
        if (!this.fileCollector.shouldInline(importPath)) continue;

        const resolvedPath = this.fileCollector.resolveImport(filePath, importPath);
        if (!resolvedPath) continue;

        for (const element of statement.exportClause.elements) {
          const exportedName = element.name.text;
          const originalName = element.propertyName?.text || exportedName;
          let resolvedOriginalName = originalName;
          if (originalName === "default") {
            const defaultExportName = this.resolveDefaultExportName(resolvedPath);
            if (!defaultExportName) continue;
            resolvedOriginalName = defaultExportName;
          }

          const key = `${resolvedPath}:${resolvedOriginalName}`;
          const declarationId = this.registry.nameIndex.get(key);
          if (declarationId) {
            const declaration = this.registry.getDeclaration(declarationId);
            if (declaration) {
              const isDefaultExport = exportedName === "default";
              declaration.exportInfo = {
                kind: isDefaultExport ? ExportKind.Default : ExportKind.Named,
                wasOriginallyExported: !isDefaultExport,
              };

              if (isDefaultExport) {
                onEntryExportDefaultName?.(resolvedOriginalName);
              }
            }
          }
        }
      } else {
        const fileImports = importMap.get(filePath);

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
              declaration.exportInfo = {
                kind: ExportKind.Named,
                wasOriginallyExported: true,
              };
            }
          }
        }
      }
    }
  }

  private resolveDefaultExportName(resolvedPath: string): string | null {
    const sourceFile = this.fileCollector.getProgram().getSourceFile(resolvedPath);
    if (!sourceFile) return null;

    for (const statement of sourceFile.statements) {
      if (!ts.isExportAssignment(statement) || statement.isExportEquals) continue;
      if (ts.isIdentifier(statement.expression)) {
        return statement.expression.text;
      }
    }

    for (const statement of sourceFile.statements) {
      if (!hasDefaultModifier(statement)) continue;
      const name = getDeclarationName(statement);
      if (name) return name;
    }

    return null;
  }

  static resolveExportEquals(
    filePath: string,
    sourceFile: ts.SourceFile,
    importMap: Map<
      string,
      Map<string, { originalName: string; sourceFile: string | null; isExternal: boolean; aliasName?: string | null }>
    >,
  ): void {
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

    for (const fileImports of importMap.values()) {
      for (const importInfo of fileImports.values()) {
        if (!importInfo.isExternal && importInfo.sourceFile === filePath) {
          importInfo.originalName = exportedName;
        }
      }
    }
  }

  private parseExportEquals(
    statement: ts.ExportAssignment,
    filePath: string,
    isEntry: boolean,
    importMap: Map<string, Map<string, { originalName: string; sourceFile: string | null; isExternal: boolean }>>,
  ): void {
    if (!ts.isIdentifier(statement.expression)) {
      return;
    }

    const exportedName = statement.expression.text;
    const fileImports = importMap.get(filePath);
    const importInfo = fileImports?.get(exportedName);

    let key: string;
    let targetFilePath: string;
    let targetName: string;

    if (importInfo && !importInfo.isExternal && importInfo.sourceFile) {
      targetFilePath = importInfo.sourceFile;
      targetName = importInfo.originalName;
      key = `${targetFilePath}:${targetName}`;
    } else {
      targetFilePath = filePath;
      targetName = exportedName;
      key = `${filePath}:${exportedName}`;
    }

    const declarationId = this.registry.nameIndex.get(key);
    if (!declarationId) return;

    const declaration = this.registry.getDeclaration(declarationId);
    if (!declaration) return;

    if (isEntry) {
      declaration.exportInfo = {
        kind: ExportKind.Equals,
        wasOriginallyExported: declaration.exportInfo.wasOriginallyExported,
      };
    } else {
      declaration.exportInfo = {
        kind: declaration.exportInfo.kind,
        wasOriginallyExported: true,
      };
    }
  }

  private parseExportDefault(statement: ts.ExportAssignment, filePath: string): void {
    const expression = statement.expression;

    if (
      (ts.isClassDeclaration(expression) ||
        ts.isFunctionDeclaration(expression) ||
        ts.isInterfaceDeclaration(expression) ||
        ts.isEnumDeclaration(expression)) &&
      expression.name
    ) {
      const name = expression.name.text;
      const hasExport = hasExportModifier(expression);
      const exportInfo: ExportInfo = {
        kind: ExportKind.Default,
        wasOriginallyExported: hasExport,
      };

      const declaration = new TypeDeclaration(name, filePath, expression, statement.getSourceFile(), exportInfo);
      this.registry.register(declaration);
      return;
    }

    if (ts.isIdentifier(expression)) {
      const exportedName = expression.text;
      const key = `${filePath}:${exportedName}`;
      const declarationId = this.registry.nameIndex.get(key);
      if (declarationId) {
        const declaration = this.registry.getDeclaration(declarationId);
        if (declaration) {
          const wasExported =
            declaration.exportInfo.kind !== ExportKind.NotExported || declaration.exportInfo.wasOriginallyExported;

          declaration.exportInfo = {
            kind: wasExported ? ExportKind.Default : ExportKind.DefaultOnly,
            wasOriginallyExported: declaration.exportInfo.wasOriginallyExported,
          };
        }
      }
    }
  }
}
