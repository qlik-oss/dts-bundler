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
    namespaceDependencies: Set<string>;
    id: symbol;
  }): void {
    const fileImports = this.importMap.get(declaration.sourceFile) ?? new Map();
    const references = new Set<string>();

    this.extractTypeReferences(declaration.node, references);

    for (const refName of references) {
      const importInfo = fileImports.get(refName);

      if (importInfo) {
        // Check if this is a namespace import (import * as namespace)
        if (!importInfo.isExternal && importInfo.originalName.startsWith("* as ")) {
          // Track this namespace dependency
          declaration.namespaceDependencies.add(refName);
          // Mark the namespace as used by adding all declarations from its source file as dependencies
          const sourceFileDecls = this.registry.declarationsByFile.get(importInfo.sourceFile);
          if (sourceFileDecls) {
            for (const declId of sourceFileDecls) {
              declaration.dependencies.add(declId);
            }
          }
        } else if (importInfo.isExternal) {
          const moduleName = importInfo.sourceFile ? importInfo.sourceFile.split(":")[0] : "";
          if (!declaration.externalDependencies.has(moduleName)) {
            declaration.externalDependencies.set(moduleName, new Set());
          }
          // Use the original import name from the registry (which might include "= " prefix)
          const importName = importInfo.originalName;
          declaration.externalDependencies.get(moduleName)?.add(importName);
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

    // Handle typeof expressions (e.g., typeof lib)
    if (ts.isTypeQueryNode(node)) {
      const exprName = node.exprName;
      if (ts.isIdentifier(exprName)) {
        references.add(exprName.text);
      } else if (ts.isQualifiedName(exprName)) {
        DependencyAnalyzer.extractQualifiedName(exprName, references);
      }
    }

    // Handle variable declarations with initializers (e.g., const Lib = lib)
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.initializer)) {
      references.add(node.initializer.text);
    }

    if ((ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node)) && node.heritageClauses) {
      for (const clause of node.heritageClauses) {
        for (const type of clause.types) {
          if (ts.isIdentifier(type.expression)) {
            references.add(type.expression.text);
          } else if (ts.isPropertyAccessExpression(type.expression)) {
            // Handle qualified names like MyModule.SomeCoolInterface
            DependencyAnalyzer.extractPropertyAccess(type.expression, references);
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

  private static extractPropertyAccess(propAccess: ts.PropertyAccessExpression, references: Set<string>): void {
    // Extract all parts of a property access chain like MyModule.SomeCoolInterface
    let current: ts.Expression = propAccess;
    while (ts.isPropertyAccessExpression(current)) {
      if (ts.isIdentifier(current.name)) {
        references.add(current.name.text);
      }
      current = current.expression;
    }
    if (ts.isIdentifier(current)) {
      references.add(current.text);
    }
  }
}
