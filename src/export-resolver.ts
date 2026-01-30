import ts from "typescript";
import { getDeclarationName, hasDefaultModifier, hasExportModifier, isDeclaration } from "./declaration-utils.js";
import type { FileCollector } from "./file-collector.js";
import { collectBindingIdentifiersFromName } from "./helpers/binding-identifiers.js";
import { resolveDefaultExportNameFromRegistry } from "./helpers/default-export.js";
import { getLibraryName } from "./helpers/node-modules.js";
import type { TypeRegistry } from "./registry.js";
import { ExportKind, TypeDeclaration, type ExportInfo, type ExportedNameInfo } from "./types.js";

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
      }
      this.parseExportDefault(statement, filePath);
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
        const typesLibraryName = this.getTypesLibraryName(filePath, importPath);
        this.registry.registerExternal(importPath, importName, statement.isTypeOnly, false, typesLibraryName);
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
        const isTypeOnlyDeclaration = ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement);
        if (ts.isVariableStatement(statement)) {
          for (const declaration of statement.declarationList.declarations) {
            if (ts.isIdentifier(declaration.name)) {
              this.registry.registerExportedName(filePath, { name: declaration.name.text, isTypeOnly: false });
              continue;
            }

            if (ts.isObjectBindingPattern(declaration.name) || ts.isArrayBindingPattern(declaration.name)) {
              for (const identifier of collectBindingIdentifiersFromName(declaration.name)) {
                this.registry.registerExportedName(filePath, { name: identifier.text, isTypeOnly: false });
              }
            }
          }
          continue;
        }

        const name = getDeclarationName(statement);
        if (name) {
          this.registry.registerExportedName(filePath, { name, isTypeOnly: isTypeOnlyDeclaration });
        }
        continue;
      }

      if (!ts.isExportDeclaration(statement)) continue;
      if (!statement.exportClause) {
        if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
        const importPath = statement.moduleSpecifier.text;
        if (this.fileCollector.shouldInline(importPath)) {
          const resolvedPath = this.fileCollector.resolveImport(filePath, importPath);
          if (resolvedPath) {
            this.registry.registerStarExport(filePath, { targetFile: resolvedPath }, isEntry);
          }
        } else {
          this.registry.registerStarExport(
            filePath,
            {
              externalModule: importPath,
              isTypeOnly: statement.isTypeOnly,
            },
            isEntry,
          );
        }
        continue;
      }

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
              const typesLibraryName = this.getTypesLibraryName(filePath, importPath);
              this.registry.registerExternal(importPath, importName, statement.isTypeOnly, false, typesLibraryName);
              this.registry.registerNamespaceExport(filePath, {
                name: exportName,
                externalModule: importPath,
                externalImportName: importName,
              });
            }
          } else {
            this.registry.registerExportedName(filePath, { name: exportName, isTypeOnly: statement.isTypeOnly });
          }
        } else {
          this.registry.registerExportedName(filePath, {
            name: exportName,
            externalModule: existingNamespaceInfo.externalModule,
            externalImportName: existingNamespaceInfo.externalImportName,
            isTypeOnly: statement.isTypeOnly,
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
              const defaultTarget = originalName === "default" ? this.resolveDefaultExportTarget(resolvedPath) : null;
              const resolvedOriginalName =
                originalName === "default" ? (defaultTarget?.name ?? originalName) : originalName;
              const resolvedSourceFile = defaultTarget?.sourceFile ?? resolvedPath;
              const exportedInfo = this.findExportedNameInfo(resolvedSourceFile, resolvedOriginalName);
              if (exportedInfo?.externalModule && exportedInfo.externalImportName) {
                const externalImportName =
                  exportedName === resolvedOriginalName
                    ? exportedInfo.externalImportName
                    : `${ExportResolver.getExternalImportBaseName(exportedInfo.externalImportName)} as ${exportedName}`;
                this.registry.registerExportedName(filePath, {
                  name: exportedName,
                  externalModule: exportedInfo.externalModule,
                  externalImportName,
                  exportFrom: exportedInfo.exportFrom,
                  isTypeOnly: statement.isTypeOnly,
                });
              } else {
                this.registry.registerExportedName(filePath, {
                  name: exportedName,
                  sourceFile: resolvedSourceFile,
                  originalName: resolvedOriginalName,
                  isTypeOnly: statement.isTypeOnly,
                });

                const starResolved = exportedInfo
                  ? null
                  : this.resolveExternalStarExport(resolvedSourceFile, resolvedOriginalName);
                if (starResolved) {
                  const starImportName =
                    exportedName === resolvedOriginalName
                      ? starResolved.importName
                      : `${ExportResolver.getExternalImportBaseName(starResolved.importName)} as ${exportedName}`;
                  this.registry.registerExportedName(filePath, {
                    name: exportedName,
                    externalModule: starResolved.moduleName,
                    externalImportName: starImportName,
                    exportFrom: true,
                    isTypeOnly: statement.isTypeOnly,
                  });
                }
              }
            }
          } else if (!isInline) {
            const importName = originalName === exportedName ? originalName : `${originalName} as ${exportedName}`;
            const typesLibraryName = this.getTypesLibraryName(filePath, importPath);
            this.registry.registerExternal(importPath, importName, statement.isTypeOnly, false, typesLibraryName);
            this.registry.registerExportedName(filePath, {
              name: exportedName,
              externalModule: importPath,
              externalImportName: importName,
              isTypeOnly: statement.isTypeOnly,
            });
          }
        }
        continue;
      }

      for (const element of statement.exportClause.elements) {
        const exportedName = element.name.text;
        const originalName = element.propertyName?.text || exportedName;
        const importInfo = fileImports?.get(originalName);
        let resolvedOriginalName = originalName;
        let resolvedSourceFile: string | null = importInfo?.sourceFile ?? null;

        if (importInfo && importInfo.originalName.startsWith("* as ") && importInfo.sourceFile) {
          if (importInfo.isExternal) {
            this.registry.registerNamespaceExport(filePath, {
              name: exportedName,
              externalModule: importInfo.sourceFile,
              externalImportName: importInfo.originalName,
            });
          } else {
            this.registry.registerNamespaceExport(filePath, {
              name: exportedName,
              targetFile: importInfo.sourceFile,
            });
          }

          if (isEntry) {
            this.registry.registerEntryNamespaceExport(filePath, exportedName);
          }
          continue;
        }

        if (importInfo && !importInfo.isExternal && importInfo.sourceFile) {
          if (importInfo.originalName === "default") {
            const defaultTarget = this.resolveDefaultExportTarget(importInfo.sourceFile);
            resolvedOriginalName = defaultTarget?.name ?? importInfo.originalName;
            resolvedSourceFile = defaultTarget?.sourceFile ?? importInfo.sourceFile;
          } else {
            resolvedOriginalName = importInfo.originalName;
            resolvedSourceFile = importInfo.sourceFile;
          }
        }

        if (importInfo && importInfo.isExternal && importInfo.sourceFile) {
          this.registry.registerExportedName(filePath, {
            name: exportedName,
            externalModule: importInfo.sourceFile,
            externalImportName: importInfo.originalName,
            isTypeOnly: statement.isTypeOnly,
          });
        } else if (importInfo && resolvedSourceFile) {
          this.registry.registerExportedName(filePath, {
            name: exportedName,
            sourceFile: resolvedSourceFile,
            originalName: resolvedOriginalName,
            isTypeOnly: statement.isTypeOnly,
          });
        } else {
          this.registry.registerExportedName(filePath, { name: exportedName, isTypeOnly: statement.isTypeOnly });
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
          const defaultTarget = originalName === "default" ? this.resolveDefaultExportTarget(resolvedPath) : null;
          const resolvedOriginalName =
            originalName === "default" ? (defaultTarget?.name ?? originalName) : originalName;
          const resolvedSourceFile = defaultTarget?.sourceFile ?? resolvedPath;
          if (originalName === "default" && !defaultTarget) continue;

          const key = `${resolvedSourceFile}:${resolvedOriginalName}`;
          const declarationIds = this.registry.getDeclarationIdsByKey(key);
          if (declarationIds) {
            const isDefaultExport = exportedName === "default";
            const isAlias = exportedName !== resolvedOriginalName && !isDefaultExport;
            if (!isAlias) {
              for (const declarationId of declarationIds) {
                const declaration = this.registry.getDeclaration(declarationId);
                if (!declaration) continue;
                const nextKind = isDefaultExport ? ExportKind.Default : ExportKind.Named;
                const currentKind = declaration.exportInfo.kind;
                const mergedDefault =
                  nextKind === ExportKind.Default &&
                  (currentKind === ExportKind.Named || currentKind === ExportKind.NamedAndDefault);
                const mergedNamed =
                  nextKind === ExportKind.Named &&
                  (currentKind === ExportKind.Default ||
                    currentKind === ExportKind.DefaultOnly ||
                    currentKind === ExportKind.NamedAndDefault);

                declaration.exportInfo = {
                  kind: mergedDefault || mergedNamed ? ExportKind.NamedAndDefault : nextKind,
                  wasOriginallyExported: declaration.exportInfo.wasOriginallyExported || !isDefaultExport,
                };
              }

              if (isDefaultExport) {
                onEntryExportDefaultName?.(resolvedOriginalName);
              }
            }
          }

          if (exportedName !== "default") {
            this.markMergedExportChain(filePath, exportedName, `${filePath}:${exportedName}`, new Set());
          }
        }
      } else {
        const fileImports = importMap.get(filePath);

        for (const element of statement.exportClause.elements) {
          const exportedName = element.name.text;
          const originalName = element.propertyName?.text || exportedName;

          const importInfo = fileImports?.get(originalName);
          let resolvedOriginalName = originalName;
          let resolvedSourceFile: string | null = importInfo?.sourceFile ?? null;
          if (importInfo && !importInfo.isExternal && importInfo.sourceFile) {
            if (importInfo.originalName === "default") {
              const defaultTarget = this.resolveDefaultExportTarget(importInfo.sourceFile);
              resolvedOriginalName = defaultTarget?.name ?? importInfo.originalName;
              resolvedSourceFile = defaultTarget?.sourceFile ?? importInfo.sourceFile;
            } else {
              resolvedOriginalName = importInfo.originalName;
              resolvedSourceFile = importInfo.sourceFile;
            }
          }
          let key: string;
          if (importInfo && !importInfo.isExternal && resolvedSourceFile) {
            const lookupName = importInfo.originalName === "default" ? resolvedOriginalName : importInfo.originalName;
            key = `${resolvedSourceFile}:${lookupName}`;
          } else {
            key = `${filePath}:${originalName}`;
          }

          const moduleAugmentation = this.findModuleAugmentationDeclaration(filePath, originalName);
          if (moduleAugmentation) {
            moduleAugmentation.exportInfo = {
              kind: ExportKind.Named,
              wasOriginallyExported: true,
            };
          }

          const declarationIds = this.registry.getDeclarationIdsByKey(key);
          if (declarationIds && !moduleAugmentation) {
            const isReExportedImport = Boolean(
              importInfo && importInfo.sourceFile && importInfo.sourceFile !== filePath,
            );
            const isAlias = resolvedOriginalName !== exportedName;
            if (!isReExportedImport || !isAlias) {
              for (const declarationId of declarationIds) {
                const declaration = this.registry.getDeclaration(declarationId);
                if (!declaration) continue;
                const currentKind = declaration.exportInfo.kind;
                const nextKind =
                  currentKind === ExportKind.Default ||
                  currentKind === ExportKind.DefaultOnly ||
                  currentKind === ExportKind.NamedAndDefault
                    ? ExportKind.NamedAndDefault
                    : ExportKind.Named;
                declaration.exportInfo = {
                  kind: nextKind,
                  wasOriginallyExported: true,
                };
              }
            }
          }

          if (!moduleAugmentation) {
            const localKey = `${filePath}:${originalName}`;
            const localDeclarationIds = this.registry.getDeclarationIdsByKey(localKey);
            if (localDeclarationIds) {
              for (const declarationId of localDeclarationIds) {
                const declaration = this.registry.getDeclaration(declarationId);
                if (!declaration) continue;
                const currentKind = declaration.exportInfo.kind;
                const nextKind =
                  currentKind === ExportKind.Default ||
                  currentKind === ExportKind.DefaultOnly ||
                  currentKind === ExportKind.NamedAndDefault
                    ? ExportKind.NamedAndDefault
                    : ExportKind.Named;
                declaration.exportInfo = {
                  kind: nextKind,
                  wasOriginallyExported: true,
                };
              }
            }
          }

          if (exportedName !== "default") {
            this.markMergedExportChain(filePath, exportedName, `${filePath}:${exportedName}`, new Set());
          }
        }
      }
    }
  }

  private markMergedExportChain(
    filePath: string,
    name: string,
    mergeGroup: string,
    visited: Set<string>,
    mergeActive = false,
  ): void {
    const key = `${filePath}:${name}`;
    if (visited.has(key)) return;
    visited.add(key);

    const exported = this.registry.exportedNamesByFile.get(filePath) ?? [];
    const hasReExport = exported.some((info) => info.name === name && Boolean(info.sourceFile));
    const declarationIds = this.registry.getDeclarationIdsByKey(key);
    const hasLocalDeclaration = Boolean(declarationIds && declarationIds.size > 0);
    const isMergePoint = hasLocalDeclaration && hasReExport;
    const nextMergeActive = mergeActive || isMergePoint;
    if (declarationIds) {
      for (const declarationId of declarationIds) {
        const declaration = this.registry.getDeclaration(declarationId);
        if (!declaration) continue;
        if (nextMergeActive) {
          declaration.mergeGroup = mergeGroup;
        }
        if (
          nextMergeActive &&
          declaration.exportInfo.kind === ExportKind.NotExported &&
          !declaration.exportInfo.wasOriginallyExported
        ) {
          declaration.exportInfo = {
            kind: ExportKind.Named,
            wasOriginallyExported: true,
          };
        }
      }
    }

    for (const info of exported) {
      if (info.name !== name) continue;
      if (info.sourceFile) {
        const originalName = info.originalName ?? info.name;
        if (isMergePoint) {
          this.addFileDependency(filePath, info.sourceFile);
        }
        this.markMergedExportChain(info.sourceFile, originalName, mergeGroup, visited, nextMergeActive);
      }
    }
  }

  private addFileDependency(sourceFile: string, targetFile: string): void {
    const sourceDeclarations = this.registry.declarationsByFile.get(sourceFile);
    const targetDeclarations = this.registry.declarationsByFile.get(targetFile);
    if (!sourceDeclarations || !targetDeclarations) {
      return;
    }

    for (const sourceId of sourceDeclarations) {
      const sourceDecl = this.registry.getDeclaration(sourceId);
      if (!sourceDecl) continue;
      for (const targetId of targetDeclarations) {
        if (sourceId === targetId) continue;
        sourceDecl.dependencies.add(targetId);
      }
    }
  }

  private findExportedNameInfo(filePath: string, name: string): ExportedNameInfo | null {
    const list = this.registry.exportedNamesByFile.get(filePath);
    if (!list) return null;
    return list.find((item) => item.name === name) ?? null;
  }

  private resolveExternalStarExport(
    filePath: string,
    exportName: string,
  ): { moduleName: string; importName: string } | null {
    const starExports = this.registry.getStarExports(filePath);
    const externalModules = starExports
      .map((star) => star.externalModule)
      .filter((moduleName): moduleName is string => Boolean(moduleName));

    if (externalModules.length === 0) {
      return null;
    }

    const checker = this.fileCollector.getTypeChecker();
    const program = this.fileCollector.getProgram();
    const sourceFile = program.getSourceFile(filePath);
    if (sourceFile) {
      const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
      if (moduleSymbol) {
        const exports = checker.getExportsOfModule(moduleSymbol);
        const exportSymbol = exports.find((symbol) => symbol.name === exportName);
        if (exportSymbol) {
          const target =
            exportSymbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exportSymbol) : exportSymbol; // eslint-disable-line no-bitwise
          const declFile = target.declarations?.[0]?.getSourceFile();
          if (declFile) {
            const moduleName = getLibraryName(declFile.fileName);
            if (moduleName && externalModules.includes(moduleName)) {
              return { moduleName, importName: exportName };
            }
          }
        }
      }
    }

    const fallbackModule = externalModules[externalModules.length - 1];
    return { moduleName: fallbackModule, importName: exportName };
  }

  private static getExternalImportBaseName(importName: string): string {
    if (importName.startsWith("default as ")) {
      return "default";
    }
    if (importName.startsWith("* as ")) {
      return importName;
    }
    if (importName.includes(" as ")) {
      return importName.split(" as ")[0].trim();
    }
    return importName;
  }

  private findModuleAugmentationDeclaration(filePath: string, name: string): TypeDeclaration | null {
    const declarations = this.registry.declarationsByFile.get(filePath);
    if (!declarations) {
      return null;
    }

    for (const declId of declarations) {
      const declaration = this.registry.getDeclaration(declId);
      if (!declaration) continue;
      if (!ts.isModuleDeclaration(declaration.node)) continue;
      if (!ts.isIdentifier(declaration.node.name)) continue;
      if (declaration.node.name.text !== name) continue;
      return declaration;
    }

    return null;
  }

  applyStarExports(): void {
    if (this.registry.entryStarExports.length === 0) return;
    const visitedFiles = new Set<string>();

    for (const entry of this.registry.entryStarExports) {
      if (entry.info.targetFile) {
        this.markStarExportedDeclarations(entry.info.targetFile, visitedFiles);
      }
    }
  }

  private markStarExportedDeclarations(filePath: string, visitedFiles: Set<string>): void {
    if (visitedFiles.has(filePath)) return;
    visitedFiles.add(filePath);

    const fileDeclarations = this.registry.declarationsByFile.get(filePath);
    if (fileDeclarations) {
      for (const declId of fileDeclarations) {
        const declaration = this.registry.getDeclaration(declId);
        if (!declaration) continue;
        if (!ts.isStatement(declaration.node)) continue;
        if (!hasExportModifier(declaration.node)) continue;
        if (hasDefaultModifier(declaration.node)) continue;
        if (declaration.exportInfo.kind === ExportKind.Equals) continue;
        if (
          declaration.exportInfo.kind === ExportKind.Default ||
          declaration.exportInfo.kind === ExportKind.DefaultOnly
        ) {
          continue;
        }

        declaration.exportInfo = {
          kind: ExportKind.Named,
          wasOriginallyExported: true,
        };
      }
    }

    for (const starExport of this.registry.getStarExports(filePath)) {
      if (starExport.targetFile) {
        this.markStarExportedDeclarations(starExport.targetFile, visitedFiles);
      }
    }
  }

  private resolveDefaultExportName(resolvedPath: string): string | null {
    return this.resolveDefaultExportTarget(resolvedPath)?.name ?? null;
  }

  private resolveDefaultExportTarget(
    resolvedPath: string,
    visited: Set<string> = new Set(),
  ): { name: string; sourceFile: string } | null {
    if (visited.has(resolvedPath)) {
      return null;
    }
    visited.add(resolvedPath);

    const registryDefault = resolveDefaultExportNameFromRegistry(this.registry, resolvedPath);
    if (registryDefault) {
      return { name: registryDefault, sourceFile: resolvedPath };
    }

    const sourceFile = this.fileCollector.getProgram().getSourceFile(resolvedPath);
    if (!sourceFile) return null;

    for (const statement of sourceFile.statements) {
      if (!ts.isExportAssignment(statement) || statement.isExportEquals) continue;
      if (ts.isIdentifier(statement.expression)) {
        const identifierName = statement.expression.text;
        const importTarget = this.resolveImportedIdentifierTarget(sourceFile, resolvedPath, identifierName, visited);
        if (importTarget) {
          return importTarget;
        }
        return { name: identifierName, sourceFile: resolvedPath };
      }
    }

    for (const statement of sourceFile.statements) {
      if (!hasDefaultModifier(statement)) continue;
      const name = getDeclarationName(statement);
      if (name) return { name, sourceFile: resolvedPath };
    }

    return null;
  }

  private resolveImportedIdentifierTarget(
    sourceFile: ts.SourceFile,
    filePath: string,
    identifierName: string,
    visited: Set<string>,
  ): { name: string; sourceFile: string } | null {
    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement)) continue;
      if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;

      const importPath = statement.moduleSpecifier.text;
      if (!this.fileCollector.shouldInline(importPath)) continue;
      const resolvedImport = this.fileCollector.resolveImport(filePath, importPath);
      if (!resolvedImport) continue;

      const importClause = statement.importClause;
      if (importClause?.name && importClause.name.text === identifierName) {
        return (
          this.resolveDefaultExportTarget(resolvedImport, visited) ?? { name: "default", sourceFile: resolvedImport }
        );
      }

      if (importClause?.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
        for (const element of importClause.namedBindings.elements) {
          const localName = element.name.text;
          if (localName !== identifierName) continue;
          const originalName = element.propertyName?.text || localName;
          if (originalName === "default") {
            return (
              this.resolveDefaultExportTarget(resolvedImport, visited) ?? {
                name: "default",
                sourceFile: resolvedImport,
              }
            );
          }
          return { name: originalName, sourceFile: resolvedImport };
        }
      }
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

    const declarationIds = this.registry.getDeclarationIdsByKey(key);
    if (!declarationIds) return;

    for (const declId of declarationIds) {
      const declaration = this.registry.getDeclaration(declId);
      if (!declaration) continue;

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
      declaration.isTypeOnly = ts.isInterfaceDeclaration(expression) || ts.isTypeAliasDeclaration(expression);
      this.registry.register(declaration);
      return;
    }

    if (ts.isIdentifier(expression)) {
      const exportedName = expression.text;
      const key = `${filePath}:${exportedName}`;
      const declarationIds = this.registry.getDeclarationIdsByKey(key);
      if (declarationIds) {
        for (const declId of declarationIds) {
          const declaration = this.registry.getDeclaration(declId);
          if (!declaration) continue;
          const wasExported =
            declaration.exportInfo.kind !== ExportKind.NotExported || declaration.exportInfo.wasOriginallyExported;
          const currentKind = declaration.exportInfo.kind;
          let nextKind: ExportKind;
          if (wasExported) {
            if (currentKind === ExportKind.Named || currentKind === ExportKind.NamedAndDefault) {
              nextKind = ExportKind.NamedAndDefault;
            } else {
              nextKind = ExportKind.Default;
            }
          } else {
            nextKind = ExportKind.DefaultOnly;
          }

          declaration.exportInfo = {
            kind: nextKind,
            wasOriginallyExported: declaration.exportInfo.wasOriginallyExported,
          };
        }
      }
    }
  }

  private getTypesLibraryName(fromFile: string, importPath: string): string | null {
    return this.fileCollector.resolveExternalImport(fromFile, importPath).typesLibraryName;
  }
}
