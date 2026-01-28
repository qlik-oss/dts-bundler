import type { TypeRegistry } from "./registry.js";
import type { ExternalImport } from "./types.js";

export class TreeShaker {
  private registry: TypeRegistry;
  private used: Set<symbol>;
  private usedExternals: Set<string>;
  private exportReferencedTypes: boolean;
  private entryFile?: string;

  constructor(registry: TypeRegistry, options: { exportReferencedTypes?: boolean; entryFile?: string } = {}) {
    this.registry = registry;
    this.used = new Set();
    this.usedExternals = new Set();
    this.exportReferencedTypes = options.exportReferencedTypes ?? true;
    this.entryFile = options.entryFile;
  }

  shake(): { declarations: Set<symbol>; externalImports: Map<string, Set<ExternalImport>> } {
    const exported = this.registry.getAllExported();

    for (const declaration of exported) {
      this.markUsed(declaration.id);
    }

    for (const declaration of this.registry.declarations.values()) {
      if (declaration.forceInclude) {
        this.markUsed(declaration.id);
      }
    }

    if (this.entryFile) {
      this.markEntryNamedExportsUsed(this.entryFile);
    }

    this.markNamespaceExportsUsed();

    return {
      declarations: this.used,
      externalImports: this.collectUsedExternalImports(),
    };
  }

  private markUsed(declarationId: symbol): void {
    if (this.used.has(declarationId)) {
      return;
    }

    this.used.add(declarationId);

    const declaration = this.registry.getDeclaration(declarationId);
    if (!declaration) return;

    if (this.exportReferencedTypes) {
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

    for (const exported of exportedNames) {
      if (exported.externalModule && exported.externalImportName) {
        this.usedExternals.add(`${exported.externalModule}:${exported.externalImportName}`);
      }

      const declFile = exported.sourceFile ?? filePath;
      const declName = exported.originalName ?? exported.name;
      this.markDeclarationsUsedByName(declFile, declName);

      const namespaceInfo = this.registry.getNamespaceExportInfo(filePath, exported.name);
      if (namespaceInfo?.targetFile) {
        this.markModuleExportsUsed(namespaceInfo.targetFile, visitedFiles);
      } else if (namespaceInfo?.externalModule && namespaceInfo.externalImportName) {
        this.usedExternals.add(`${namespaceInfo.externalModule}:${namespaceInfo.externalImportName}`);
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
      const declName = exported.originalName ?? exported.name;
      this.markDeclarationsUsedByName(declFile, declName);
    }
  }

  private markDeclarationsUsedByName(sourceFile: string, name: string): void {
    const declIds = this.registry.getDeclarationIds(sourceFile, name);
    if (!declIds) return;
    for (const declId of declIds) {
      this.markUsed(declId);
    }
  }
}
