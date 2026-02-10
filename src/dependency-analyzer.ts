import path from "node:path";
import ts from "typescript";
import { hasDefaultModifier } from "./declaration-utils.js";
import type { FileCollector } from "./file-collector.js";
import type { TypeRegistry } from "./registry.js";
import { ExportKind } from "./types.js";

/**
 * Responsible for analyzing type and value references in registered declarations
 * and populating their dependency sets accordingly. This includes resolving
 * imports, handling namespace references and tracking external module usage.
 */
export class DependencyAnalyzer {
  private registry: TypeRegistry;
  /**
   * Map of file -> (imported name -> import metadata).
   * The metadata contains the original imported name, resolved source file
   * (or null for externals), whether the import is external, an optional
   * alias and whether it was marked type-only.
   */
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
  private fileCollector: FileCollector;

  /**
   * Create a `DependencyAnalyzer` responsible for converting type/value
   * references in declarations into dependency sets that the bundler can use.
   *
   * @param registry - Shared `TypeRegistry` with declarations and helpers.
   * @param importMap - Map of file imports produced by `ImportParser`.
   * @param fileCollector - Helper used for resolving imports and program access.
   * @param entryFile - Optional entry file path used to prefer entry aliases.
   */
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
    fileCollector: FileCollector,
    entryFile?: string,
  ) {
    this.registry = registry;
    this.importMap = importMap;
    this.fileCollector = fileCollector;
    this.entryFile = entryFile;
  }

  /**
   * Analyze all registered declarations and populate their dependency sets.
   */
  analyze(): void {
    this.trackEntryFileAliases();

    for (const declaration of this.registry.declarations.values()) {
      this.analyzeDependencies(declaration);
    }
  }

  /**
   * If the entry file imports a symbol under an alias and that alias is used
   * as a type in the entry file, prefer that alias as the `normalizedName` on
   * the referenced declaration(s).
   */
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
        const declIds = this.registry.getDeclarationIdsByKey(key);
        if (declIds) {
          for (const declId of declIds) {
            const decl = this.registry.getDeclaration(declId);
            if (decl) {
              decl.normalizedName = importInfo.aliasName;
            }
          }
        }
      }
    }
  }

  /**
   * Collect type reference identifiers used in the entry file. This looks for
   * simple type references, qualified names and type queries and returns the
   * set of left-most identifiers referenced by those nodes.
   */
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

  /**
   * Return the left-most identifier text from a possibly-qualified `EntityName`.
   */
  private static getLeftmostEntityName(entity: ts.EntityName): string | null {
    let current: ts.EntityName = entity;
    while (ts.isQualifiedName(current)) {
      current = current.left;
    }
    return ts.isIdentifier(current) ? current.text : null;
  }

  /**
   * Analyze dependencies for a single declaration. This will populate:
   * - `declaration.dependencies` with other internal declaration ids
   * - `declaration.externalDependencies` with external module usage
   * - `declaration.namespaceDependencies` when a namespace import is referenced
   * - `declaration.importAliases` for aliased imports
   */
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
    const valueReferences = new Set<string>();

    this.extractTypeReferences(declaration.node, references, valueReferences);
    this.trackImportTypeDependencies(declaration);

    for (const refName of valueReferences) {
      const importInfo = fileImports.get(refName);
      if (importInfo?.isExternal && importInfo.sourceFile) {
        this.registry.markExternalValueUsage(importInfo.sourceFile, importInfo.originalName);
      }
    }

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
              const resolvedMemberName =
                memberName === "default"
                  ? (this.getDefaultExportName(importInfo.sourceFile) ?? memberName)
                  : memberName;
              const key = `${importInfo.sourceFile}:${resolvedMemberName}`;
              const depIds = this.registry.getDeclarationIdsByKey(key);
              if (depIds) {
                for (const depId of depIds) {
                  declaration.dependencies.add(depId);
                }
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
          const hasImportedDecl = this.registry.hasDeclarationKey(importedKey);
          const hasOriginalDecl = this.registry.hasDeclarationKey(originalKey);

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
          let depIds = this.registry.getDeclarationIdsByKey(key);
          if (!depIds && refName !== originalName) {
            depIds = this.registry.getDeclarationIdsByKey(importedKey);
          }
          if (depIds) {
            for (const depId of depIds) {
              declaration.dependencies.add(depId);
            }
          } else {
            const resolved = this.resolveStarExportedDeclarationIds(importInfo.sourceFile, originalName, new Set());
            if (resolved) {
              for (const depId of resolved.declarationIds) {
                declaration.dependencies.add(depId);
              }
              importInfo.sourceFile = resolved.targetFile;
            }
          }
        }
      } else {
        const localKey = `${declaration.sourceFile}:${refName}`;
        const localIds = this.registry.getDeclarationIdsByKey(localKey);
        if (localIds) {
          for (const localId of localIds) {
            if (localId === declaration.id) continue;
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
  }

  /**
   * Handle `import("module").X` style nodes by resolving the module and
   * adding the referenced declarations to the dependency set.
   */
  private trackImportTypeDependencies(declaration: {
    node: ts.Node;
    sourceFile: string;
    dependencies: Set<symbol>;
  }): void {
    const importTypeReferences = DependencyAnalyzer.collectImportTypeReferences(declaration.node);
    for (const ref of importTypeReferences) {
      const resolvedPath = this.resolveImportTypeModule(declaration.sourceFile, ref.moduleName);
      if (!resolvedPath) continue;

      const leftmost = DependencyAnalyzer.getLeftmostEntityName(ref.qualifier);
      if (!leftmost) continue;

      const key = `${resolvedPath}:${leftmost}`;
      const depIds = this.registry.getDeclarationIdsByKey(key);
      if (depIds) {
        for (const depId of depIds) {
          declaration.dependencies.add(depId);
        }
      }
    }
  }

  /**
   * Resolve an `import(...)` module name to a file path, ensuring it is inlined
   * in the project and contains declarations.
   */
  private resolveImportTypeModule(fromFile: string, moduleName: string): string | null {
    if (!this.fileCollector.shouldInline(moduleName, fromFile)) {
      return null;
    }

    const resolvedPath = this.fileCollector.resolveImport(fromFile, moduleName);
    if (!resolvedPath) return null;
    if (!this.registry.declarationsByFile.has(resolvedPath)) return null;
    return resolvedPath;
  }

  /**
   * Collect `import("x").T` references found under `node`.
   */
  private static collectImportTypeReferences(
    node: ts.Node,
  ): Array<{ moduleName: string; qualifier: ts.EntityName; isTypeOf: boolean }> {
    const refs: Array<{ moduleName: string; qualifier: ts.EntityName; isTypeOf: boolean }> = [];

    const visit = (current: ts.Node): void => {
      if (ts.isImportTypeNode(current) && current.qualifier) {
        const argument = current.argument;
        if (ts.isLiteralTypeNode(argument) && ts.isStringLiteral(argument.literal)) {
          refs.push({
            moduleName: argument.literal.text,
            qualifier: current.qualifier,
            isTypeOf: current.isTypeOf,
          });
        }
      }

      current.forEachChild(visit);
    };

    visit(node);
    return refs;
  }

  /**
   * Find the default export name for a given source file by inspecting
   * registered declarations and the file's export assignments.
   */
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

    const sourceFileNode = this.fileCollector.getProgram().getSourceFile(sourceFile);
    if (sourceFileNode) {
      for (const statement of sourceFileNode.statements) {
        if (!ts.isExportAssignment(statement) || statement.isExportEquals) {
          continue;
        }
        if (ts.isIdentifier(statement.expression)) {
          return statement.expression.text;
        }
      }
    }

    return null;
  }

  /**
   * Walk `node` and collect type and (optionally) value references.
   * - `references` receives type-level identifier names
   * - `valueReferences` receives names used in value positions when available
   */
  private extractTypeReferences(node: ts.Node, references: Set<string>, valueReferences?: Set<string>): void {
    const addReference = (name: string): void => {
      references.add(name);
    };
    const addValueReference = (name: string): void => {
      references.add(name);
      valueReferences?.add(name);
    };

    if (ts.isModuleDeclaration(node) && ts.isIdentifier(node.name)) {
      addReference(node.name.text);
    }

    if (ts.isTypeReferenceNode(node)) {
      const typeName = node.typeName;
      if (ts.isIdentifier(typeName)) {
        addReference(typeName.text);
      } else if (ts.isQualifiedName(typeName)) {
        DependencyAnalyzer.extractQualifiedName(typeName, references);
      }
    }

    // Handle typeof expressions (e.g., typeof lib)
    if (ts.isTypeQueryNode(node)) {
      const exprName = node.exprName;
      if (ts.isIdentifier(exprName)) {
        addReference(exprName.text);
      } else if (ts.isQualifiedName(exprName)) {
        DependencyAnalyzer.extractQualifiedName(exprName, references);
        const leftmost = DependencyAnalyzer.getLeftmostEntityName(exprName);
        if (leftmost) {
          addReference(leftmost);
        }
      }
    }

    // Handle variable declarations with initializers (e.g., const Lib = lib)
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.initializer)) {
      addValueReference(node.initializer.text);
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
              if (ts.isClassDeclaration(node)) {
                addValueReference(type.expression.text);
              } else {
                addReference(type.expression.text);
              }
            } else if (ts.isPropertyAccessExpression(type.expression)) {
              // Handle qualified names like MyModule.SomeCoolInterface
              DependencyAnalyzer.extractPropertyAccess(type.expression, references);
              const leftmost = DependencyAnalyzer.getLeftmostPropertyAccessRoot(type.expression);
              if (leftmost && ts.isClassDeclaration(node)) {
                addValueReference(leftmost);
              }
            }
          }
        }
      }
    };

    if (!isCtsFile) {
      processHeritageClauses();
    }

    if (ts.isFunctionLike(node) && "body" in node && node.body) {
      node.forEachChild((child) => {
        if (child === node.body) {
          return;
        }
        this.extractTypeReferences(child, references, valueReferences);
      });
      return;
    }

    node.forEachChild((child) => {
      this.extractTypeReferences(child, references, valueReferences);
    });

    if (isCtsFile) {
      processHeritageClauses();
    }
  }

  /**
   * Pull the left-most identifier from a `QualifiedName` and add it to `references`.
   */
  private static extractQualifiedName(qualifiedName: ts.QualifiedName, references: Set<string>): void {
    let current: ts.EntityName = qualifiedName;
    while (ts.isQualifiedName(current)) {
      current = current.left;
    }
    if (ts.isIdentifier(current)) {
      references.add(current.text);
    }
  }

  /**
   * Inspect `node` for references to members of `namespaceName` and return the set
   * of member identifiers found (e.g., from `MyNs.X` or `import("x").Y`).
   */
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

  /**
   * Given a qualified name like `Ns.A.B`, return the first member `A` when the
   * root matches `namespaceName`.
   */
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

  /**
   * Given a property access expression like `ns.A.B`, return the first member
   * `A` when the root matches `namespaceName`.
   */
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

  /**
   * For a property access chain `ns.A.B`, extract the left-most identifier
   * (`ns`) and add it to `references`.
   */
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

  /**
   * Return the left-most identifier text from a property access chain or `null`.
   */
  private static getLeftmostPropertyAccessRoot(propAccess: ts.PropertyAccessExpression): string | null {
    let current: ts.Expression = propAccess;
    while (ts.isPropertyAccessExpression(current)) {
      current = current.expression;
    }
    return ts.isIdentifier(current) ? current.text : null;
  }

  /**
   * Resolve declarations exported via `export * from ...` chains. Prevents
   * infinite recursion by tracking visited files.
   */
  private resolveStarExportedDeclarationIds(
    sourceFile: string,
    name: string,
    visited: Set<string>,
  ): { targetFile: string; declarationIds: Set<symbol> } | null {
    if (visited.has(sourceFile)) {
      return null;
    }

    visited.add(sourceFile);

    const starExports = this.registry.getStarExports(sourceFile);
    for (const starExport of starExports) {
      if (!starExport.targetFile) {
        continue;
      }

      const key = `${starExport.targetFile}:${name}`;
      const declarationIds = this.registry.getDeclarationIdsByKey(key);
      if (declarationIds) {
        return { targetFile: starExport.targetFile, declarationIds };
      }

      const nested = this.resolveStarExportedDeclarationIds(starExport.targetFile, name, visited);
      if (nested) {
        return nested;
      }
    }

    return null;
  }
}
