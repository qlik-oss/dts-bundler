import ts from "typescript";
import type { TypeRegistry } from "./registry.js";
import type { ExternalImport, TypeDeclaration } from "./types.js";

export class NameNormalizer {
  private registry: TypeRegistry;
  private nameCounter: Map<string, number>;

  constructor(registry: TypeRegistry) {
    this.registry = registry;
    this.nameCounter = new Map();
  }

  normalize(): void {
    const byName = new Map<string, TypeDeclaration[]>();

    for (const declaration of this.registry.declarations.values()) {
      const name = declaration.normalizedName;
      if (!byName.has(name)) {
        byName.set(name, []);
      }
      byName.get(name)?.push(declaration);
    }

    for (const [name, declarations] of byName.entries()) {
      if (declarations.length > 1) {
        const hasInlineAugmentation = declarations.some((decl) => decl.forceInclude);
        const allInterfaces = declarations.every((decl) => ts.isInterfaceDeclaration(decl.node));
        if (hasInlineAugmentation && allInterfaces) {
          continue;
        }
        for (let i = 1; i < declarations.length; i++) {
          const counter = this.nameCounter.get(name) || 1;
          this.nameCounter.set(name, counter + 1);
          declarations[i].normalizedName = `${name}_${counter}`;
        }
      }
    }

    this.normalizeExternalImports();
  }

  private normalizeExternalImports(): void {
    const importNameCounts = new Map<string, ExternalImport[]>();

    for (const moduleImports of this.registry.externalImports.values()) {
      for (const externalImport of moduleImports.values()) {
        const name = NameNormalizer.extractImportName(externalImport.originalName);
        if (!importNameCounts.has(name)) {
          importNameCounts.set(name, []);
        }
        importNameCounts.get(name)?.push(externalImport);
      }
    }

    for (const [name, imports] of importNameCounts.entries()) {
      if (imports.length > 1) {
        for (let i = 1; i < imports.length; i++) {
          const counter = this.nameCounter.get(name) || 1;
          this.nameCounter.set(name, counter + 1);
          const newName = `${name}_${counter}`;

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

  private static extractImportName(importStr: string): string {
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
