import type { TypeRegistry } from "./registry.js";
import type { ExternalImport } from "./types.js";

export class TreeShaker {
  private registry: TypeRegistry;
  private used: Set<symbol>;
  private usedExternals: Set<string>;
  private exportReferencedTypes: boolean;

  constructor(registry: TypeRegistry, options: { exportReferencedTypes?: boolean } = {}) {
    this.registry = registry;
    this.used = new Set();
    this.usedExternals = new Set();
    this.exportReferencedTypes = options.exportReferencedTypes ?? true;
  }

  shake(): { declarations: Set<symbol>; externalImports: Map<string, Set<ExternalImport>> } {
    const exported = this.registry.getAllExported();

    for (const declaration of exported) {
      this.markUsed(declaration.id);
    }

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
}
