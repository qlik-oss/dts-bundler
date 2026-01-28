import path from "node:path";
import ts from "typescript";
import { hasDefaultModifier } from "./declaration-utils.js";
import type { TypeRegistry } from "./registry.js";
import { ExportKind } from "./types.js";

export class DependencyAnalyzer {
  private registry: TypeRegistry;
  private importMap: Map<
    string,
    Map<
      string,
      {
        originalName: string;
        sourceFile: string | null;
        isExternal: boolean;
        aliasName?: string | null;
        isTypeOnly?: boolean;
      }
    >
  >;
  private entryFile?: string;

  constructor(
    registry: TypeRegistry,
    importMap: Map<
      string,
      Map<
        string,
        {
          originalName: string;
          sourceFile: string | null;
          isExternal: boolean;
          aliasName?: string | null;
          isTypeOnly?: boolean;
        }
      >
    >,
    entryFile?: string,
  ) {
    this.registry = registry;
    this.importMap = importMap;
    this.entryFile = entryFile;
  }

  analyze(): void {
    this.trackEntryFileAliases();

    for (const declaration of this.registry.declarations.values()) {
      this.analyzeDependencies(declaration);
    }
  }

  private trackEntryFileAliases(): void {
    if (!this.entryFile) {
      return;
    }

    const fileImports = this.importMap.get(this.entryFile);
    if (!fileImports) {
      return;
    }

    const entryTypeRefs = this.collectEntryTypeReferences(this.entryFile);

    for (const [, importInfo] of fileImports.entries()) {
      if (!importInfo.isExternal && importInfo.aliasName && entryTypeRefs.has(importInfo.aliasName)) {
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

  private collectEntryTypeReferences(entryFile: string): Set<string> {
    const refs = new Set<string>();
    const declarations = this.registry.declarationsByFile.get(entryFile);
    if (!declarations) return refs;

    const visit = (node: ts.Node): void => {
      if (ts.isTypeReferenceNode(node)) {
        const typeName = node.typeName;
        if (ts.isIdentifier(typeName)) {
          refs.add(typeName.text);
        } else if (ts.isQualifiedName(typeName)) {
          const leftmost = DependencyAnalyzer.getLeftmostEntityName(typeName);
          if (leftmost) refs.add(leftmost);
        }
      }

      if (ts.isTypeQueryNode(node)) {
        const leftmost = DependencyAnalyzer.getLeftmostEntityName(node.exprName);
        if (leftmost) refs.add(leftmost);
      }

      node.forEachChild(visit);
    };

    for (const declId of declarations) {
      const decl = this.registry.getDeclaration(declId);
      if (decl) {
        visit(decl.node);
      }
    }

    return refs;
  }

  private static getLeftmostEntityName(entity: ts.EntityName): string | null {
    let current: ts.EntityName = entity;
    while (ts.isQualifiedName(current)) {
      current = current.left;
    }
    return ts.isIdentifier(current) ? current.text : null;
  }

  private analyzeDependencies(declaration: {
    node: ts.Node;
    sourceFile: string;
    dependencies: Set<symbol>;
    externalDependencies: Map<string, Set<string>>;
    namespaceDependencies: Set<string>;
    importAliases: Map<string, { sourceFile: string; originalName: string; qualifiedName?: string }>;
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

          const memberNames = DependencyAnalyzer.collectNamespaceMemberReferences(declaration.node, refName);
          if (memberNames.size > 0) {
            for (const memberName of memberNames) {
              const key = `${importInfo.sourceFile}:${memberName}`;
              const depId = this.registry.nameIndex.get(key);
              if (depId) {
                declaration.dependencies.add(depId);
              }
            }
          } else {
            // Fallback: include all declarations from the namespace source file
            const sourceFileDecls = this.registry.declarationsByFile.get(importInfo.sourceFile);
            if (sourceFileDecls) {
              for (const declId of sourceFileDecls) {
                declaration.dependencies.add(declId);
              }
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
          let originalName = importInfo.originalName;
          if (originalName === "default") {
            const defaultName = this.getDefaultExportName(importInfo.sourceFile);
            if (defaultName) {
              originalName = defaultName;
            }
          }

          const importedKey = `${importInfo.sourceFile}:${refName}`;
          const originalKey = `${importInfo.sourceFile}:${originalName}`;
          const hasImportedDecl = this.registry.nameIndex.has(importedKey);
          const hasOriginalDecl = this.registry.nameIndex.has(originalKey);

          if (importInfo.aliasName || refName !== originalName) {
            const aliasEntry: { sourceFile: string; originalName: string; qualifiedName?: string } = {
              sourceFile: importInfo.sourceFile,
              originalName,
            };

            if (!importInfo.aliasName && !hasImportedDecl && hasOriginalDecl && refName !== originalName) {
              aliasEntry.qualifiedName = `${originalName}.${refName}`;
            }

            declaration.importAliases.set(refName, aliasEntry);
          }

          const key = `${importInfo.sourceFile}:${originalName}`;
          const depId = this.registry.nameIndex.get(key);
          if (depId) {
            declaration.dependencies.add(depId);
          }
        }
      } else {
        const localKey = `${declaration.sourceFile}:${refName}`;
        const localId = this.registry.nameIndex.get(localKey);
        if (localId && localId !== declaration.id) {
          const localDecl = this.registry.getDeclaration(localId);
          if (localDecl && ts.isModuleDeclaration(localDecl.node)) {
            const sourceFile = localDecl.sourceFileNode;
            const hasExportEquals = sourceFile.statements.some(
              (statement) => ts.isExportAssignment(statement) && statement.isExportEquals,
            );
            if (!hasExportEquals) {
              continue;
            }
          }
          declaration.dependencies.add(localId);
        }
      }
    }
  }

  private getDefaultExportName(sourceFile: string): string | null {
    const declarations = this.registry.declarationsByFile.get(sourceFile);
    if (!declarations) return null;

    for (const declId of declarations) {
      const decl = this.registry.getDeclaration(declId);
      if (!decl) continue;
      if (
        decl.exportInfo.kind === ExportKind.Default ||
        decl.exportInfo.kind === ExportKind.DefaultOnly ||
        (ts.isStatement(decl.node) && hasDefaultModifier(decl.node))
      ) {
        return decl.name;
      }
    }

    return null;
  }

  private extractTypeReferences(node: ts.Node, references: Set<string>): void {
    if (ts.isModuleDeclaration(node) && ts.isIdentifier(node.name)) {
      references.add(node.name.text);
    }

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

    // Handle property access expressions (e.g., Foo.Bar)
    if (ts.isPropertyAccessExpression(node)) {
      DependencyAnalyzer.extractPropertyAccess(node, references);
    }

    const isCtsFile = (() => {
      const sourceFile = node.getSourceFile();
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!sourceFile) {
        return false;
      }
      const ext = path.extname(sourceFile.fileName).toLowerCase();
      return ext === ".cts" || ext === ".d.cts";
    })();

    const processHeritageClauses = (): void => {
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
    };

    if (!isCtsFile) {
      processHeritageClauses();
    }

    node.forEachChild((child) => {
      this.extractTypeReferences(child, references);
    });

    if (isCtsFile) {
      processHeritageClauses();
    }
  }

  private static extractQualifiedName(qualifiedName: ts.QualifiedName, references: Set<string>): void {
    let current: ts.EntityName = qualifiedName;
    while (ts.isQualifiedName(current)) {
      current = current.left;
    }
    if (ts.isIdentifier(current)) {
      references.add(current.text);
    }
  }

  private static collectNamespaceMemberReferences(node: ts.Node, namespaceName: string): Set<string> {
    const members = new Set<string>();

    const visit = (child: ts.Node): void => {
      if (ts.isTypeReferenceNode(child)) {
        const typeName = child.typeName;
        if (ts.isQualifiedName(typeName)) {
          const member = DependencyAnalyzer.getFirstQualifiedMember(typeName, namespaceName);
          if (member) {
            members.add(member);
          }
        }
      }

      if (ts.isTypeQueryNode(child)) {
        const exprName = child.exprName;
        if (ts.isQualifiedName(exprName)) {
          const member = DependencyAnalyzer.getFirstQualifiedMember(exprName, namespaceName);
          if (member) {
            members.add(member);
          }
        } else if (ts.isPropertyAccessExpression(exprName)) {
          const member = DependencyAnalyzer.getFirstPropertyAccessMember(exprName, namespaceName);
          if (member) {
            members.add(member);
          }
        }
      }

      if (ts.isPropertyAccessExpression(child)) {
        const member = DependencyAnalyzer.getFirstPropertyAccessMember(child, namespaceName);
        if (member) {
          members.add(member);
        }
      }

      child.forEachChild(visit);
    };

    visit(node);
    return members;
  }

  private static getFirstQualifiedMember(qualifiedName: ts.QualifiedName, namespaceName: string): string | null {
    const parts: string[] = [];
    let current: ts.EntityName = qualifiedName;
    while (ts.isQualifiedName(current)) {
      parts.unshift(current.right.text);
      current = current.left;
    }

    if (ts.isIdentifier(current) && current.text === namespaceName) {
      return parts[0] ?? null;
    }

    return null;
  }

  private static getFirstPropertyAccessMember(
    propAccess: ts.PropertyAccessExpression,
    namespaceName: string,
  ): string | null {
    const parts: string[] = [];
    let current: ts.Expression = propAccess;
    while (ts.isPropertyAccessExpression(current)) {
      parts.unshift(current.name.text);
      current = current.expression;
    }

    if (ts.isIdentifier(current) && current.text === namespaceName) {
      return parts[0] ?? null;
    }

    return null;
  }

  private static extractPropertyAccess(propAccess: ts.PropertyAccessExpression, references: Set<string>): void {
    // Extract only the leftmost identifier for a property access chain like MyModule.SomeCoolInterface
    let current: ts.Expression = propAccess;
    while (ts.isPropertyAccessExpression(current)) {
      current = current.expression;
    }
    if (ts.isIdentifier(current)) {
      references.add(current.text);
    }
  }
}
