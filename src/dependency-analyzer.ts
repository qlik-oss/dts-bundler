import ts from "typescript";
import type { TypeRegistry } from "./registry.js";

export class DependencyAnalyzer {
  private registry: TypeRegistry;
  private importMap: Map<
    string,
    Map<string, { originalName: string; sourceFile: string | null; isExternal: boolean; aliasName?: string | null }>
  >;

  constructor(
    registry: TypeRegistry,
    importMap: Map<
      string,
      Map<string, { originalName: string; sourceFile: string | null; isExternal: boolean; aliasName?: string | null }>
    >,
  ) {
    this.registry = registry;
    this.importMap = importMap;
  }

  analyze(): void {
    this.trackEntryFileAliases();

    for (const declaration of this.registry.declarations.values()) {
      this.analyzeDependencies(declaration);
    }
  }

  private trackEntryFileAliases(): void {
    const entryFiles = new Set<string>();
    for (const declaration of this.registry.declarations.values()) {
      if (declaration.isExported) {
        entryFiles.add(declaration.sourceFile);
      }
    }

    for (const entryFile of entryFiles) {
      const fileImports = this.importMap.get(entryFile);
      if (!fileImports) continue;

      for (const [, importInfo] of fileImports.entries()) {
        if (!importInfo.isExternal && importInfo.aliasName) {
          const key = `${importInfo.sourceFile}:${importInfo.originalName}`;
          const declId = this.registry.nameIndex.get(key);
          if (declId) {
            const decl = this.registry.getDeclaration(declId);
            if (decl) {
              decl.normalizedName = importInfo.aliasName;
            }
          }
        }
      }
    }
  }

  private analyzeDependencies(declaration: {
    node: ts.Node;
    sourceFile: string;
    dependencies: Set<symbol>;
    externalDependencies: Map<string, Set<string>>;
    id: symbol;
  }): void {
    const fileImports = this.importMap.get(declaration.sourceFile) ?? new Map();
    const references = new Set<string>();

    this.extractTypeReferences(declaration.node, references);

    for (const refName of references) {
      const importInfo = fileImports.get(refName);

      if (importInfo) {
        if (importInfo.isExternal) {
          const moduleName = importInfo.sourceFile ? importInfo.sourceFile.split(":")[0] : "";
          if (!declaration.externalDependencies.has(moduleName)) {
            declaration.externalDependencies.set(moduleName, new Set());
          }
          declaration.externalDependencies.get(moduleName)?.add(refName);
        } else if (importInfo.sourceFile) {
          const key = `${importInfo.sourceFile}:${importInfo.originalName}`;
          const depId = this.registry.nameIndex.get(key);
          if (depId) {
            declaration.dependencies.add(depId);
          }
        }
      } else {
        const localKey = `${declaration.sourceFile}:${refName}`;
        const localId = this.registry.nameIndex.get(localKey);
        if (localId && localId !== declaration.id) {
          declaration.dependencies.add(localId);
        }
      }
    }
  }

  private extractTypeReferences(node: ts.Node, references: Set<string>): void {
    if (ts.isTypeReferenceNode(node)) {
      const typeName = node.typeName;
      if (ts.isIdentifier(typeName)) {
        references.add(typeName.text);
      } else if (ts.isQualifiedName(typeName)) {
        DependencyAnalyzer.extractQualifiedName(typeName, references);
      }
    }

    if ((ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node)) && node.heritageClauses) {
      for (const clause of node.heritageClauses) {
        for (const type of clause.types) {
          if (ts.isIdentifier(type.expression)) {
            references.add(type.expression.text);
          }
        }
      }
    }

    node.forEachChild((child) => {
      this.extractTypeReferences(child, references);
    });
  }

  private static extractQualifiedName(qualifiedName: ts.QualifiedName, references: Set<string>): void {
    let current: ts.EntityName = qualifiedName;
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
