import ts from "typescript";
import type { TypeRegistry } from "./registry.js";
import { ExportKind, type ExternalImport, type ImportInfo } from "./types.js";

export class TreeShaker {
  private registry: TypeRegistry;
  private used: Set<symbol>;
  private usedExternals: Set<string>;
  private exportReferencedTypes: boolean;
  private entryExportsOnly: boolean;
  private entryFile?: string;
  private entryImports?: Map<string, ImportInfo>;
  private entrySourceFile?: ts.SourceFile;

  constructor(
    registry: TypeRegistry,
    options: {
      exportReferencedTypes?: boolean;
      entryExportsOnly?: boolean;
      entryFile?: string;
      entryImports?: Map<string, ImportInfo>;
      entrySourceFile?: ts.SourceFile;
    } = {},
  ) {
    this.registry = registry;
    this.used = new Set();
    this.usedExternals = new Set();
    this.exportReferencedTypes = options.exportReferencedTypes ?? true;
    this.entryExportsOnly = options.entryExportsOnly ?? false;
    this.entryFile = options.entryFile;
    this.entryImports = options.entryImports;
    this.entrySourceFile = options.entrySourceFile;
  }

  shake(): {
    declarations: Set<symbol>;
    externalImports: Map<string, Set<ExternalImport>>;
    detectedTypesLibraries: Set<string>;
  } {
    const useEntryExportsOnly = this.entryExportsOnly && Boolean(this.entryFile);

    if (!useEntryExportsOnly) {
      const exported = this.registry.getAllExported();

      for (const declaration of exported) {
        this.markUsed(declaration.id);
      }
    }

    for (const declaration of this.registry.declarations.values()) {
      if (declaration.forceInclude) {
        this.markUsed(declaration.id);
      }
    }

    if (this.entryFile) {
      this.markEntryNamedExportsUsed(this.entryFile);
      this.markEntryExportAssignmentsUsed(this.entryFile);
      this.markEntryStarExportsUsed();
    }

    this.markNamespaceExportsUsed();

    return {
      declarations: this.used,
      externalImports: this.collectUsedExternalImports(),
      detectedTypesLibraries: this.collectDetectedTypesLibraries(),
    };
  }

  private collectDetectedTypesLibraries(): Set<string> {
    const result = new Set<string>();

    for (const [moduleName, moduleImports] of this.registry.externalImports.entries()) {
      for (const [importName, externalImport] of moduleImports.entries()) {
        const key = `${moduleName}:${importName}`;
        if (this.usedExternals.has(key) && externalImport.typesLibraryName) {
          result.add(externalImport.typesLibraryName);
        }
      }
    }

    return result;
  }

  private markUsed(declarationId: symbol): void {
    if (this.used.has(declarationId)) {
      return;
    }

    this.used.add(declarationId);

    const declaration = this.registry.getDeclaration(declarationId);
    if (!declaration) return;

    const shouldIncludeDependencies = this.exportReferencedTypes || declaration.dependencies.size > 0;
    if (shouldIncludeDependencies) {
      for (const depId of declaration.dependencies) {
        this.markUsed(depId);
      }
    }

    for (const [moduleName, importNames] of declaration.externalDependencies.entries()) {
      for (const importName of importNames) {
        this.usedExternals.add(`${moduleName}:${importName}`);
      }
    }
  }

  private collectUsedExternalImports(): Map<string, Set<ExternalImport>> {
    const result = new Map<string, Set<ExternalImport>>();

    for (const [moduleName, moduleImports] of this.registry.externalImports.entries()) {
      for (const [importName, externalImport] of moduleImports.entries()) {
        const key = `${moduleName}:${importName}`;
        if (this.usedExternals.has(key)) {
          if (!result.has(moduleName)) {
            result.set(moduleName, new Set());
          }
          result.get(moduleName)?.add(externalImport);
        }
      }
    }

    return result;
  }

  private markNamespaceExportsUsed(): void {
    if (this.registry.entryNamespaceExports.length === 0) return;
    const visitedFiles = new Set<string>();

    const depthCache = new Map<string, number>();
    const entryExports = this.registry.entryNamespaceExports.map((entry) => ({
      entry,
      depth: this.getNamespaceExportDepth(entry, depthCache),
    }));

    entryExports.sort((a, b) => b.depth - a.depth);

    for (const { entry } of entryExports) {
      const info = this.registry.getNamespaceExportInfo(entry.sourceFile, entry.name);
      if (!info) continue;

      if (info.targetFile) {
        this.markModuleExportsUsed(info.targetFile, visitedFiles);
      } else if (info.externalModule && info.externalImportName) {
        this.usedExternals.add(`${info.externalModule}:${info.externalImportName}`);
      }
    }
  }

  private getNamespaceExportDepth(
    entry: { name: string; sourceFile: string },
    depthCache: Map<string, number>,
  ): number {
    const key = `${entry.sourceFile}:${entry.name}`;
    if (depthCache.has(key)) return depthCache.get(key) as number;

    const info = this.registry.getNamespaceExportInfo(entry.sourceFile, entry.name);
    if (!info || !info.targetFile) {
      depthCache.set(key, 1);
      return 1;
    }

    const exportedNames = this.registry.exportedNamesByFile.get(info.targetFile) ?? [];
    let maxChild = 0;
    for (const exported of exportedNames) {
      const childInfo = this.registry.getNamespaceExportInfo(info.targetFile, exported.name);
      if (childInfo && childInfo.targetFile) {
        const childDepth = this.getNamespaceExportDepth(
          { name: exported.name, sourceFile: info.targetFile },
          depthCache,
        );
        if (childDepth > maxChild) {
          maxChild = childDepth;
        }
      }
    }

    const depth = 1 + maxChild;
    depthCache.set(key, depth);
    return depth;
  }

  private markModuleExportsUsed(filePath: string, visitedFiles: Set<string>): void {
    if (visitedFiles.has(filePath)) return;
    visitedFiles.add(filePath);

    const exportedNames = this.registry.exportedNamesByFile.get(filePath) ?? [];

    for (const starExport of this.registry.getStarExports(filePath)) {
      if (starExport.targetFile) {
        this.markModuleExportsUsed(starExport.targetFile, visitedFiles);
      }
    }

    for (const exported of exportedNames) {
      if (exported.externalModule && exported.externalImportName) {
        this.usedExternals.add(`${exported.externalModule}:${exported.externalImportName}`);
      }

      const declFile = exported.sourceFile ?? filePath;
      let declName = exported.originalName ?? exported.name;
      if (declName === "default") {
        const defaultName = this.getDefaultExportName(declFile);
        if (defaultName) {
          declName = defaultName;
        }
      }
      this.markDeclarationsUsedByName(declFile, declName);

      const namespaceInfo = this.registry.getNamespaceExportInfo(filePath, exported.name);
      if (namespaceInfo?.targetFile) {
        this.markModuleExportsUsed(namespaceInfo.targetFile, visitedFiles);
      } else if (namespaceInfo?.externalModule && namespaceInfo.externalImportName) {
        this.usedExternals.add(`${namespaceInfo.externalModule}:${namespaceInfo.externalImportName}`);
      }
    }
  }

  private markEntryStarExportsUsed(): void {
    if (this.registry.entryStarExports.length === 0) return;
    const visitedFiles = new Set<string>();

    for (const entry of this.registry.entryStarExports) {
      if (entry.info.targetFile) {
        this.markModuleExportsUsed(entry.info.targetFile, visitedFiles);
      }
    }
  }

  private markEntryNamedExportsUsed(entryFile: string): void {
    const exportedNames = this.registry.exportedNamesByFile.get(entryFile) ?? [];
    for (const exported of exportedNames) {
      if (exported.externalModule && exported.externalImportName) {
        this.usedExternals.add(`${exported.externalModule}:${exported.externalImportName}`);
        continue;
      }

      const declFile = exported.sourceFile ?? entryFile;
      let declName = exported.originalName ?? exported.name;
      if (declName === "default") {
        const defaultName = this.getDefaultExportName(declFile);
        if (defaultName) {
          declName = defaultName;
        }
      }
      this.markDeclarationsUsedByName(declFile, declName);
    }
  }

  private markEntryExportAssignmentsUsed(entryFile: string): void {
    if (!this.entrySourceFile) {
      return;
    }

    for (const statement of this.entrySourceFile.statements) {
      if (!ts.isExportAssignment(statement)) continue;
      if (!ts.isIdentifier(statement.expression)) continue;
      const exportName = statement.expression.text;
      const importInfo = this.entryImports?.get(exportName);
      if (importInfo?.sourceFile) {
        let originalName = importInfo.originalName;
        if (originalName === "default") {
          const defaultName = this.getDefaultExportName(importInfo.sourceFile);
          if (defaultName) {
            originalName = defaultName;
          }
        }
        const shouldSkipTypeOnlyImport = this.shouldSkipTypeOnlyImportExport(importInfo.sourceFile, originalName);
        if (!shouldSkipTypeOnlyImport) {
          this.markDeclarationsUsedByName(importInfo.sourceFile, originalName);
        }
        continue;
      }

      this.markDeclarationsUsedByName(entryFile, exportName);
    }
  }

  private shouldSkipTypeOnlyImportExport(sourceFile: string, name: string): boolean {
    const declIds = this.registry.getDeclarationIds(sourceFile, name);
    if (!declIds || declIds.size === 0) return false;

    let hasValueDeclaration = false;
    for (const declId of declIds) {
      const decl = this.registry.getDeclaration(declId);
      if (!decl) continue;
      if (!decl.isTypeOnly) {
        hasValueDeclaration = true;
        break;
      }
    }

    if (hasValueDeclaration) return false;

    for (const decl of this.registry.declarations.values()) {
      if (decl.sourceFile === sourceFile) continue;
      if (decl.name === name && decl.forceInclude) {
        return true;
      }
    }

    return false;
  }

  private getDefaultExportName(sourceFile: string): string | null {
    const declarations = this.registry.declarationsByFile.get(sourceFile);
    if (!declarations) return null;

    for (const declId of declarations) {
      const decl = this.registry.getDeclaration(declId);
      if (!decl) continue;
      if (decl.exportInfo.kind === ExportKind.Default || decl.exportInfo.kind === ExportKind.DefaultOnly) {
        return decl.name;
      }
    }

    return null;
  }

  private markDeclarationsUsedByName(sourceFile: string, name: string): void {
    const declIds = this.registry.getDeclarationIds(sourceFile, name);
    if (!declIds) return;
    for (const declId of declIds) {
      this.markUsed(declId);
    }
  }
}
