import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { isDeclareGlobal } from "./declaration-utils";
import type { TypeRegistry } from "./registry";
import { ExportKind, type ExternalImport, type TypeDeclaration } from "./types";

export class NameNormalizer {
  /**
   * Responsible for normalizing and disambiguating symbol names across the
   * project so generated declaration output does not contain collisions.
   */
  private registry: TypeRegistry;
  private nameCounter: Map<string, number>;
  private entryFile?: string;
  private typeChecker?: ts.TypeChecker;

  constructor(registry: TypeRegistry, entryFile?: string, typeChecker?: ts.TypeChecker) {
    /**
     * Create a `NameNormalizer`.
     * @param registry - The `TypeRegistry` containing declarations and external imports.
     * @param entryFile - Optional path to the bundle entry file used to prefer entry-sourced names.
     * @param typeChecker - Optional TypeScript `TypeChecker` for global name analysis.
     */
    this.registry = registry;
    this.nameCounter = new Map();
    this.entryFile = entryFile;
    this.typeChecker = typeChecker;
  }

  normalize(): void {
    /**
     * Main entrypoint: run name normalization across all registered
     * declarations and external imports. This performs grouping of
     * colliding declarations, assigns stable suffixes, and coordinates a
     * set of conflict-resolution passes.
     */
    const byName = new Map<string, TypeDeclaration[]>();
    const entrySourceOrder = this.getEntrySourceOrder();
    const entryBasenameOrder = this.getEntryBasenameOrder();
    const entryExportedSources = this.getEntryExportedSources();
    const exportEqualsFiles = this.getExportEqualsFiles();
    const globalReferencedNames = this.collectGlobalReferencedNames();

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
        const hasModuleDeclaration = declarations.some((decl) => ts.isModuleDeclaration(decl.node));
        const hasInterfaceDeclaration = declarations.some((decl) => ts.isInterfaceDeclaration(decl.node));
        const allInterfacesOrModules = declarations.every(
          (decl) => ts.isInterfaceDeclaration(decl.node) || ts.isModuleDeclaration(decl.node),
        );
        const mergeGroup = declarations[0]?.mergeGroup ?? null;
        const allSameMergeGroup = mergeGroup !== null && declarations.every((decl) => decl.mergeGroup === mergeGroup);
        if (hasInlineAugmentation && allInterfaces) {
          continue;
        }
        if (hasModuleDeclaration && hasInterfaceDeclaration && allInterfacesOrModules) {
          continue;
        }
        if (allSameMergeGroup) {
          continue;
        }
        const grouped = new Map<
          string,
          {
            sourceFile: string;
            declarations: TypeDeclaration[];
            firstIndex: number;
            exported: boolean;
            entryExported: boolean;
            hasExportEquals: boolean;
            moduleOnly: boolean;
          }
        >();

        declarations.forEach((decl, index) => {
          const group = grouped.get(decl.sourceFile);
          const isExported = decl.exportInfo.kind !== ExportKind.NotExported || decl.exportInfo.wasOriginallyExported;
          if (!group) {
            grouped.set(decl.sourceFile, {
              sourceFile: decl.sourceFile,
              declarations: [decl],
              firstIndex: index,
              exported: isExported,
              entryExported: entryExportedSources.has(decl.sourceFile),
              hasExportEquals: exportEqualsFiles.has(decl.sourceFile),
              moduleOnly: ts.isModuleDeclaration(decl.node),
            });
            return;
          }
          group.declarations.push(decl);
          if (isExported) {
            group.exported = true;
          }
          if (entryExportedSources.has(decl.sourceFile)) {
            group.entryExported = true;
          }
          if (!ts.isModuleDeclaration(decl.node)) {
            group.moduleOnly = false;
          }
        });

        const orderedGroups = Array.from(grouped.values()).sort((a, b) => {
          if (a.entryExported !== b.entryExported) {
            return a.entryExported ? -1 : 1;
          }
          if (!a.entryExported && !b.entryExported && a.exported !== b.exported) {
            return a.exported ? -1 : 1;
          }
          if (a.hasExportEquals !== b.hasExportEquals) {
            return a.hasExportEquals ? 1 : -1;
          }
          if (a.moduleOnly !== b.moduleOnly) {
            return a.moduleOnly ? 1 : -1;
          }
          const aEntryOrder = entrySourceOrder.get(a.sourceFile);
          const bEntryOrder = entrySourceOrder.get(b.sourceFile);
          if (aEntryOrder !== undefined && bEntryOrder !== undefined && aEntryOrder !== bEntryOrder) {
            return aEntryOrder - bEntryOrder;
          }
          if (aEntryOrder !== undefined && bEntryOrder === undefined) {
            return -1;
          }
          if (aEntryOrder === undefined && bEntryOrder !== undefined) {
            return 1;
          }
          const aBase = entryBasenameOrder.get(path.basename(a.sourceFile, path.extname(a.sourceFile)));
          const bBase = entryBasenameOrder.get(path.basename(b.sourceFile, path.extname(b.sourceFile)));
          if (aBase !== undefined && bBase !== undefined && aBase !== bBase) {
            return aBase - bBase;
          }
          const pathOrder = a.sourceFile.localeCompare(b.sourceFile);
          if (pathOrder !== 0) {
            return pathOrder;
          }
          return a.firstIndex - b.firstIndex;
        });

        for (let i = 1; i < orderedGroups.length; i++) {
          const counter = this.nameCounter.get(name) || 1;
          this.nameCounter.set(name, counter + 1);
          const normalized = `${name}$${counter}`;
          for (const decl of orderedGroups[i].declarations) {
            decl.normalizedName = normalized;
          }
        }
      }
    }

    this.normalizeGlobalDeclarationConflicts(globalReferencedNames);
    this.normalizeExternalImports();
    this.normalizeExternalNamespaceImports();
    const protectedExternalNames = this.getProtectedExternalNames();
    this.normalizeDeclarationProtectedExternalConflicts(protectedExternalNames);
    this.normalizeExternalImportDeclarationConflicts();
  }

  private getProtectedExternalNames(): Set<string> {
    /**
     * Return a set of external names that must be preserved (protected)
     * because the entry file exports them as external imports/namespace exports.
     */
    if (!this.entryFile) {
      return new Set();
    }

    const protectedNames = new Set<string>();
    const exported = this.registry.exportedNamesByFile.get(this.entryFile) ?? [];
    for (const info of exported) {
      if (info.externalModule && info.externalImportName) {
        protectedNames.add(info.name);
      }
    }

    for (const entry of this.registry.entryNamespaceExports) {
      if (entry.sourceFile !== this.entryFile) continue;
      const info = this.registry.getNamespaceExportInfo(entry.sourceFile, entry.name);
      if (info?.externalModule && info.externalImportName) {
        protectedNames.add(entry.name);
      }
    }

    return protectedNames;
  }

  private getEntrySourceOrder(): Map<string, number> {
    /**
     * Determine ordering for sources referenced directly by the entry file.
     * Used as a tie-breaker when choosing which declaration keeps the
     * canonical name during conflicts.
     */
    const order = new Map<string, number>();
    if (!this.entryFile) {
      return order;
    }

    const exported = this.registry.exportedNamesByFile.get(this.entryFile) ?? [];
    exported.forEach((info, index) => {
      if (!info.sourceFile) {
        return;
      }
      if (!order.has(info.sourceFile)) {
        order.set(info.sourceFile, index);
      }
    });

    try {
      const entryDir = path.dirname(this.entryFile);
      const sourceText = fs.readFileSync(this.entryFile, "utf8");
      const sourceFile = ts.createSourceFile(this.entryFile, sourceText, ts.ScriptTarget.Latest, true);
      let stmtIndex = order.size;

      const registerModulePath = (modulePath: string): void => {
        if (!modulePath.startsWith(".")) {
          return;
        }
        const resolved = this.resolveSourceFileFromRegistry(entryDir, modulePath);
        if (resolved && !order.has(resolved)) {
          order.set(resolved, stmtIndex);
          stmtIndex += 1;
        }
      };

      for (const statement of sourceFile.statements) {
        if (
          ts.isExportDeclaration(statement) &&
          statement.moduleSpecifier &&
          ts.isStringLiteral(statement.moduleSpecifier)
        ) {
          registerModulePath(statement.moduleSpecifier.text);
        }
        if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
          registerModulePath(statement.moduleSpecifier.text);
        }
      }
    } catch {
      // Ignore entry parsing errors and fall back to exported order
    }

    return order;
  }

  private resolveSourceFileFromRegistry(entryDir: string, modulePath: string): string | null {
    /**
     * Resolve a relative module path (from the entry) to a source file path
     * known in the `registry.declarationsByFile` map. Returns null if not
     * found.
     */
    const basePath = path.resolve(entryDir, modulePath);
    const candidates = [
      basePath,
      `${basePath}.ts`,
      `${basePath}.d.ts`,
      `${basePath}.mts`,
      `${basePath}.cts`,
      path.join(basePath, "index.ts"),
      path.join(basePath, "index.d.ts"),
      path.join(basePath, "index.mts"),
      path.join(basePath, "index.cts"),
    ];

    for (const candidate of candidates) {
      if (this.registry.declarationsByFile.has(candidate)) {
        return candidate;
      }
    }

    const normalizedBase = basePath.replace(/\\/g, "/");
    for (const filePath of this.registry.declarationsByFile.keys()) {
      const normalizedPath = filePath.replace(/\\/g, "/");
      if (normalizedPath === normalizedBase) {
        return filePath;
      }
      if (normalizedPath.endsWith(`${normalizedBase}.ts`)) {
        return filePath;
      }
      if (normalizedPath.endsWith(`${normalizedBase}.d.ts`)) {
        return filePath;
      }
      if (normalizedPath.endsWith(`${normalizedBase}.mts`)) {
        return filePath;
      }
      if (normalizedPath.endsWith(`${normalizedBase}.cts`)) {
        return filePath;
      }
    }

    return null;
  }

  private getEntryBasenameOrder(): Map<string, number> {
    /**
     * Collect the ordering of module basenames referenced by the entry file.
     * This is a weaker ordering than `getEntrySourceOrder` but useful for
     * deterministic tie-breaking when only basenames differ.
     */
    const order = new Map<string, number>();
    if (!this.entryFile) {
      return order;
    }

    try {
      const sourceText = fs.readFileSync(this.entryFile, "utf8");
      const sourceFile = ts.createSourceFile(this.entryFile, sourceText, ts.ScriptTarget.Latest, true);
      let stmtIndex = 0;

      const registerModule = (modulePath: string): void => {
        if (!modulePath.startsWith(".")) {
          return;
        }
        const base = path.basename(modulePath);
        if (!order.has(base)) {
          order.set(base, stmtIndex);
          stmtIndex += 1;
        }
      };

      for (const statement of sourceFile.statements) {
        if (
          ts.isExportDeclaration(statement) &&
          statement.moduleSpecifier &&
          ts.isStringLiteral(statement.moduleSpecifier)
        ) {
          registerModule(statement.moduleSpecifier.text);
        }
        if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
          registerModule(statement.moduleSpecifier.text);
        }
      }
    } catch {
      // ignore
    }

    return order;
  }

  private getEntryExportedSources(): Set<string> {
    /**
     * Return a set of source file paths that are exported (directly or via
     * namespace re-exports) from the entry file. Used to prefer exported
     * declarations when resolving name collisions.
     */
    const sources = new Set<string>();
    if (!this.entryFile) {
      return sources;
    }

    const exported = this.registry.exportedNamesByFile.get(this.entryFile) ?? [];
    for (const info of exported) {
      if (info.sourceFile) {
        sources.add(info.sourceFile);
      } else {
        sources.add(this.entryFile);
      }
    }

    for (const entry of this.registry.entryNamespaceExports) {
      if (entry.sourceFile !== this.entryFile) continue;
      const info = this.registry.getNamespaceExportInfo(entry.sourceFile, entry.name);
      if (info?.targetFile) {
        sources.add(info.targetFile);
      }
    }

    return sources;
  }

  private getExportEqualsFiles(): Set<string> {
    /**
     * Identify files that contain `export =` (export equals) assignments.
     * Files with export-equals behave differently with respect to symbol
     * merging and are considered during normalization.
     */
    const files = new Set<string>();

    for (const [filePath, declarations] of this.registry.declarationsByFile.entries()) {
      const declId = declarations.values().next().value as symbol | undefined;
      if (!declId) continue;
      const decl = this.registry.getDeclaration(declId);
      if (!decl) continue;
      const sourceFile = decl.sourceFileNode;
      const hasExportEquals = sourceFile.statements.some(
        (statement) => ts.isExportAssignment(statement) && statement.isExportEquals,
      );
      if (hasExportEquals) {
        files.add(filePath);
      }
    }

    return files;
  }

  private normalizeExternalImports(): void {
    /**
     * Normalize external import local names to avoid collisions between
     * multiple imports that would produce the same local binding name.
     * For example, `import {A} from 'x'` and `import {A} from 'y'`.
     */
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

  private normalizeExternalNamespaceImports(): void {
    /**
     * Ensure a canonical namespace local name is used when multiple
     * `* as` namespace imports would otherwise produce different local
     * names. The first one becomes canonical and others are aligned to it.
     */
    for (const moduleImports of this.registry.externalImports.values()) {
      const namespaceImports = Array.from(moduleImports.values()).filter((imp) => imp.originalName.startsWith("* as "));
      if (namespaceImports.length <= 1) {
        continue;
      }

      const canonical = namespaceImports[0];
      const canonicalName = NameNormalizer.extractImportName(canonical.normalizedName);
      for (let i = 1; i < namespaceImports.length; i++) {
        namespaceImports[i].normalizedName = `* as ${canonicalName}`;
      }
    }
  }

  private normalizeDeclarationProtectedExternalConflicts(protectedExternalNames: Set<string>): void {
    /**
     * If certain external names are protected by the entry file, rename any
     * conflicting declarations so they do not collide with those external
     * names.
     */
    if (protectedExternalNames.size === 0) {
      return;
    }

    const usedNames = new Set<string>();
    for (const declaration of this.registry.declarations.values()) {
      usedNames.add(declaration.normalizedName);
    }
    for (const moduleImports of this.registry.externalImports.values()) {
      for (const externalImport of moduleImports.values()) {
        usedNames.add(NameNormalizer.extractImportName(externalImport.normalizedName));
      }
    }

    for (const declaration of this.registry.declarations.values()) {
      const current = declaration.normalizedName;
      if (!protectedExternalNames.has(current)) {
        continue;
      }

      let counter = 1;
      let candidate = `${current}$${counter}`;
      while (usedNames.has(candidate)) {
        counter += 1;
        candidate = `${current}$${counter}`;
      }

      declaration.normalizedName = candidate;
      usedNames.add(candidate);
    }
  }

  private normalizeExternalImportDeclarationConflicts(): void {
    /**
     * Resolve conflicts where an external import's local name collides with
     * a declaration name. External imports will be renamed to avoid the
     * collision and maintain uniqueness.
     */
    const declarationNames = new Set<string>();
    for (const declaration of this.registry.declarations.values()) {
      declarationNames.add(declaration.normalizedName);
    }

    if (declarationNames.size === 0) {
      return;
    }

    const usedNames = new Set<string>(declarationNames);
    for (const moduleImports of this.registry.externalImports.values()) {
      for (const externalImport of moduleImports.values()) {
        usedNames.add(NameNormalizer.extractImportName(externalImport.normalizedName));
      }
    }

    for (const moduleImports of this.registry.externalImports.values()) {
      for (const externalImport of moduleImports.values()) {
        const importName = NameNormalizer.extractImportName(externalImport.normalizedName);
        if (!declarationNames.has(importName)) {
          continue;
        }

        let counter = 1;
        let candidate = `${importName}$${counter}`;
        while (usedNames.has(candidate)) {
          counter += 1;
          candidate = `${importName}$${counter}`;
        }

        externalImport.normalizedName = NameNormalizer.replaceImportLocalName(externalImport.normalizedName, candidate);
        usedNames.add(candidate);
      }
    }
  }

  private static replaceImportLocalName(importStr: string, newLocalName: string): string {
    if (importStr.startsWith("default as ")) {
      return `default as ${newLocalName}`;
    }
    if (importStr.startsWith("* as ")) {
      return `* as ${newLocalName}`;
    }
    if (importStr.includes(" as ")) {
      const [original] = importStr.split(" as ");
      return `${original} as ${newLocalName}`;
    }
    return `${importStr} as ${newLocalName}`;
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

  private normalizeGlobalDeclarationConflicts(globalReferencedNames: Set<string>): void {
    /**
     * Rename declarations that would conflict with names available in the
     * global scope (as reported by the TypeChecker) to avoid accidental
     * shadowing of true global symbols.
     */
    if (!this.typeChecker || globalReferencedNames.size === 0) {
      return;
    }

    const usedNames = new Set<string>();
    for (const declaration of this.registry.declarations.values()) {
      usedNames.add(declaration.normalizedName);
    }

    for (const declaration of this.registry.declarations.values()) {
      const current = declaration.normalizedName;
      if (!globalReferencedNames.has(current)) {
        continue;
      }
      if (!this.isGlobalName(current)) {
        continue;
      }
      if (NameNormalizer.isWithinGlobalAugmentation(declaration.node)) {
        continue;
      }

      let counter = 1;
      let candidate = `${current}$${counter}`;
      while (usedNames.has(candidate) || this.isGlobalName(candidate)) {
        counter += 1;
        candidate = `${current}$${counter}`;
      }

      declaration.normalizedName = candidate;
      usedNames.add(candidate);
    }
  }

  private isGlobalName(name: string): boolean {
    /**
     * Determine whether a given name resolves to a global symbol according
     * to the provided `TypeChecker`.
     */
    if (!this.typeChecker) {
      return false;
    }

    interface Ts54CompatTypeChecker extends ts.TypeChecker {
      resolveName(
        name: string,
        location: ts.Node | undefined,
        meaning: ts.SymbolFlags,
        excludeGlobals: boolean,
      ): ts.Symbol | undefined;
    }

    const tsSymbolFlagsAll = -1 as ts.SymbolFlags;
    return (
      (this.typeChecker as Ts54CompatTypeChecker).resolveName(name, undefined, tsSymbolFlagsAll, false) !== undefined
    );
  }

  private collectGlobalReferencedNames(): Set<string> {
    /**
     * Walk all registered declaration ASTs and collect names that resolve
     * to global symbols according to the `TypeChecker`. Used to protect
     * declarations from colliding with real globals.
     */
    const globalNames = new Set<string>();
    if (!this.typeChecker) {
      return globalNames;
    }

    const resolveGlobal = (name: string): ts.Symbol | undefined => {
      interface Ts54CompatTypeChecker extends ts.TypeChecker {
        resolveName(
          name: string,
          location: ts.Node | undefined,
          meaning: ts.SymbolFlags,
          excludeGlobals: boolean,
        ): ts.Symbol | undefined;
      }

      const tsSymbolFlagsAll = -1 as ts.SymbolFlags;
      return (this.typeChecker as Ts54CompatTypeChecker).resolveName(name, undefined, tsSymbolFlagsAll, false);
    };

    const checkName = (nameNode: ts.Identifier): void => {
      const name = nameNode.text;
      const symbol = this.typeChecker?.getSymbolAtLocation(nameNode);
      if (!symbol) return;
      const globalSymbol = resolveGlobal(name);
      if (globalSymbol && globalSymbol === symbol) {
        globalNames.add(name);
      }
    };

    const visit = (node: ts.Node): void => {
      if (ts.isTypeReferenceNode(node)) {
        const typeName = node.typeName;
        if (ts.isIdentifier(typeName)) {
          checkName(typeName);
        } else if (ts.isQualifiedName(typeName)) {
          const leftmost = NameNormalizer.getLeftmostIdentifier(typeName);
          if (leftmost) checkName(leftmost);
        }
      }

      if (ts.isTypeQueryNode(node)) {
        const exprName = node.exprName;
        const leftmost = NameNormalizer.getLeftmostIdentifier(exprName);
        if (leftmost) checkName(leftmost);
      }

      node.forEachChild(visit);
    };

    for (const declaration of this.registry.declarations.values()) {
      visit(declaration.node);
    }

    return globalNames;
  }

  private static getLeftmostIdentifier(entity: ts.EntityName): ts.Identifier | null {
    /**
     * Retrieve the left-most identifier from a possibly qualified name
     * (e.g. `A.B.C` -> `A`). Returns null if not an identifier.
     */
    let current: ts.EntityName = entity;
    while (ts.isQualifiedName(current)) {
      current = current.left;
    }
    return ts.isIdentifier(current) ? current : null;
  }

  private static isWithinGlobalAugmentation(node: ts.Node): boolean {
    /**
     * Walk ancestors to determine whether `node` is inside a `declare global`
     * augmentation, in which case global name conflicts are intentionally
     * allowed.
     */
    for (let current: ts.Node = node; !ts.isSourceFile(current); current = current.parent) {
      if (isDeclareGlobal(current as ts.Statement)) {
        return true;
      }
    }
    return false;
  }

  /**
   * After tree-shaking, strip unnecessary $N/_N suffixes from names whose collisions were removed.
   * Also renumber remaining suffixes to fill gaps (e.g. $2 becomes $1 if $0 was removed).
   */
  static stripUnnecessarySuffixes(
    registry: TypeRegistry,
    usedDeclarations: Set<symbol>,
    usedExternals: Map<string, Set<ExternalImport>>,
  ): void {
    const suffixPattern = /^(.+?)(?:\$(\d+)|_(\d+))$/;
    const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    type SuffixedEntity =
      | { kind: "declaration"; declaration: TypeDeclaration }
      | { kind: "external"; external: ExternalImport };

    const baseNameGroups = new Map<string, Map<string, SuffixedEntity[]>>();

    const addToGroup = (baseName: string, normalizedName: string, entity: SuffixedEntity): void => {
      if (!baseNameGroups.has(baseName)) {
        baseNameGroups.set(baseName, new Map());
      }
      const group = baseNameGroups.get(baseName);
      if (!group) {
        return;
      }
      if (!group.has(normalizedName)) {
        group.set(normalizedName, []);
      }
      group.get(normalizedName)?.push(entity);
    };

    for (const id of usedDeclarations) {
      const decl = registry.getDeclaration(id);
      if (!decl) continue;
      const name = decl.normalizedName;
      const match = name.match(suffixPattern);
      const baseName = match ? match[1] : name;
      addToGroup(baseName, name, { kind: "declaration", declaration: decl });
    }

    for (const imports of usedExternals.values()) {
      for (const ext of imports) {
        const importName = NameNormalizer.extractImportName(ext.normalizedName);
        const match = importName.match(suffixPattern);
        const baseName = match ? match[1] : importName;
        addToGroup(baseName, importName, { kind: "external", external: ext });
      }
    }

    for (const [baseName, normalizedGroups] of baseNameGroups) {
      const distinctNames = Array.from(normalizedGroups.keys()).sort((a, b) => {
        if (a === baseName) return -1;
        if (b === baseName) return 1;
        return a.localeCompare(b);
      });

      const escapedBase = escapeRegExp(baseName);
      const dollarPattern = new RegExp(`^${escapedBase}\\$\\d+$`);
      const underscorePattern = new RegExp(`^${escapedBase}_\\d+$`);
      const hasDollar = distinctNames.some((name) => dollarPattern.test(name));
      const hasUnderscore = distinctNames.some((name) => underscorePattern.test(name));
      const separator = hasUnderscore && !hasDollar ? "_" : "$";

      let needsRenumber = false;
      if (distinctNames.length === 1 && distinctNames[0] !== baseName) {
        needsRenumber = true;
      } else if (distinctNames.length > 1) {
        for (let i = 0; i < distinctNames.length; i++) {
          const expected = i === 0 ? baseName : `${baseName}${separator}${i}`;
          if (distinctNames[i] !== expected) {
            needsRenumber = true;
            break;
          }
        }
      }

      if (!needsRenumber) continue;

      for (let i = 0; i < distinctNames.length; i++) {
        const currentName = distinctNames[i];
        const targetName = i === 0 ? baseName : `${baseName}${separator}${i}`;
        if (currentName === targetName) continue;

        const entities = normalizedGroups.get(currentName) ?? [];
        for (const entity of entities) {
          if (entity.kind === "declaration") {
            entity.declaration.normalizedName = targetName;
            continue;
          }

          const originalName = NameNormalizer.extractImportName(entity.external.originalName);
          if (targetName === originalName) {
            entity.external.normalizedName = entity.external.originalName;
          } else {
            entity.external.normalizedName = NameNormalizer.replaceImportLocalName(
              entity.external.normalizedName,
              targetName,
            );
          }
        }
      }
    }
  }
}
