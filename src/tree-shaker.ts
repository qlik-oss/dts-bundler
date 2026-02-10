import ts from "typescript";
import type { TypeRegistry } from "./registry.js";
import { ExportKind, type ExternalImport, type ImportInfo, type TypeDeclaration } from "./types.js";

/**
 * Perform tree-shaking analysis on the registry to determine which
 * declarations and external imports are actually used and should be
 * included in the generated bundle.
 */
export class TreeShaker {
  /** The shared `TypeRegistry` containing declarations and imports. */
  private registry: TypeRegistry;
  /** Set of declaration symbols that are used and should be emitted. */
  private used: Set<symbol>;
  /** Set of external module names that are used and should be emitted. */
  private usedExternals: Set<string>;
  /** Map of external module names to sets of external imports that are used and should be emitted. */
  private processedGlobal: Set<symbol>;
  /** Set of non-global declaration symbols that have been processed. */
  private processedNonGlobal: Set<symbol>;
  /** Map of external module names to sets of external imports that are used and should be emitted. */
  private entryFile?: string;
  /** Map of external module names to sets of external imports that are used and should be emitted. */
  private entryImports?: Map<string, ImportInfo>;
  /** Optional AST for the entry used to inspect export assignments. */
  private entrySourceFile?: ts.SourceFile;
  /** Optional set of files directly imported by the entry. */
  private entryImportedFiles: Set<string>;
  /** Optional set of files referenced by the entry (import types, etc.). */
  private entryReferencedFiles: Set<string>;

  /**
   * Create a `TreeShaker`.
   * @param registry - The shared `TypeRegistry` containing declarations and imports.
   * @param options.entryFile - Optional entry file path used to seed usage analysis.
   * @param options.entryImports - Optional map of local name -> import info from the entry.
   * @param options.entrySourceFile - Optional AST for the entry used to inspect export assignments.
   * @param options.entryImportedFiles - Optional set of files directly imported by the entry.
   * @param options.entryReferencedFiles - Optional set of files referenced by the entry (import types, etc.).
   */
  constructor(
    registry: TypeRegistry,
    options: {
      entryFile?: string;
      entryImports?: Map<string, ImportInfo>;
      entrySourceFile?: ts.SourceFile;
      entryImportedFiles?: Set<string>;
      entryReferencedFiles?: Set<string>;
    } = {},
  ) {
    this.registry = registry;
    this.used = new Set();
    this.usedExternals = new Set();
    this.processedGlobal = new Set();
    this.processedNonGlobal = new Set();
    this.entryFile = options.entryFile;
    this.entryImports = options.entryImports;
    this.entrySourceFile = options.entrySourceFile;
    this.entryImportedFiles = options.entryImportedFiles ?? new Set();
    this.entryReferencedFiles = options.entryReferencedFiles ?? new Set();
  }

  shake(): {
    declarations: Set<symbol>;
    externalImports: Map<string, Set<ExternalImport>>;
    detectedTypesLibraries: Set<string>;
    declarationOrder: Map<symbol, number>;
  } {
    /**
     * Run the tree-shaking algorithm and return the set of declarations and
     * external imports that must be emitted. The result also includes any
     * detected `@types` libraries and a declaration ordering map.
     */
    const declarationOrder = this.buildDeclarationOrder();

    for (const declaration of this.registry.declarations.values()) {
      if (!declaration.forceInclude) {
        continue;
      }
      if (this.entryFile && TreeShaker.isGlobalDeclaration(declaration)) {
        const isEntryFile = declaration.sourceFile === this.entryFile;
        const isEntryImport = this.entryImportedFiles.has(declaration.sourceFile);
        if (!isEntryFile && !isEntryImport) {
          continue;
        }
      }
      const context = TreeShaker.isGlobalDeclaration(declaration) ? "global" : "nonGlobal";
      this.markUsed(declaration.id, context);
    }

    if (this.entryFile) {
      for (const declaration of this.registry.declarations.values()) {
        if (!ts.isModuleDeclaration(declaration.node)) {
          continue;
        }
        const isEntryFile = declaration.sourceFile === this.entryFile;
        const isReferencedFile = this.entryReferencedFiles.has(declaration.sourceFile);
        if (!isEntryFile && !isReferencedFile) {
          continue;
        }
        if (TreeShaker.isGlobalDeclaration(declaration) && !declaration.forceInclude) {
          continue;
        }
        if (!isEntryFile && !ts.isStringLiteral(declaration.node.name)) {
          continue;
        }
        const context = TreeShaker.isGlobalDeclaration(declaration) ? "global" : "nonGlobal";
        this.markUsed(declaration.id, context);
      }
    }

    if (this.entryFile) {
      this.markEntryNamedExportsUsed(this.entryFile, "nonGlobal");
      this.markEntryExportAssignmentsUsed(this.entryFile, "nonGlobal");
      this.markEntryStarExportsUsed("nonGlobal");
    }

    this.markNamespaceExportsUsed("nonGlobal");

    return {
      declarations: this.used,
      externalImports: this.collectUsedExternalImports(),
      detectedTypesLibraries: this.collectDetectedTypesLibraries(),
      declarationOrder,
    };
  }

  private buildDeclarationOrder(): Map<symbol, number> {
    /**
     * Build a deterministic ordering for declarations that should be
     * emitted. Declarations forced-included by analysis are recorded and
     * their dependencies are also visited to produce a stable order.
     */
    const order = new Map<symbol, number>();
    const visited = new Set<symbol>();

    const record = (id: symbol): void => {
      if (visited.has(id)) return;
      visited.add(id);
      const declaration = this.registry.getDeclaration(id);
      if (!declaration) return;
      order.set(id, order.size);
      const shouldIncludeDependencies = declaration.dependencies.size > 0;
      if (shouldIncludeDependencies) {
        for (const depId of declaration.dependencies) {
          record(depId);
        }
      }
    };

    for (const declaration of this.registry.declarations.values()) {
      if (declaration.forceInclude) {
        record(declaration.id);
      }
    }

    return order;
  }

  private collectDetectedTypesLibraries(): Set<string> {
    /**
     * Collect a set of `@types` library names that are referenced by used
     * external imports (so the emitter may add appropriate references).
     */
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

  private markUsed(declarationId: symbol, context: "global" | "nonGlobal"): void {
    /**
     * Mark a declaration as used in the given context and recursively
     * include its dependency graph and external imports.
     */
    const declaration = this.registry.getDeclaration(declarationId);
    if (!declaration) return;

    if (context === "global") {
      declaration.usedInGlobal = true;
    } else {
      declaration.usedInNonGlobal = true;
    }

    const processed = context === "global" ? this.processedGlobal : this.processedNonGlobal;
    if (processed.has(declarationId)) {
      this.used.add(declarationId);
      return;
    }

    processed.add(declarationId);
    this.used.add(declarationId);

    const shouldIncludeDependencies = declaration.dependencies.size > 0;
    if (shouldIncludeDependencies) {
      for (const depId of declaration.dependencies) {
        this.markUsed(depId, context);
      }
    }

    for (const [moduleName, importNames] of declaration.externalDependencies.entries()) {
      for (const importName of importNames) {
        this.usedExternals.add(`${moduleName}:${importName}`);
      }
    }
  }

  private collectUsedExternalImports(): Map<string, Set<ExternalImport>> {
    /**
     * Return the set of external imports that were recorded as used during
     * analysis, grouped by module name.
     */
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

  private markNamespaceExportsUsed(context: "global" | "nonGlobal"): void {
    /**
     * Mark namespace exports (exported via `export * as ns`) as used when
     * they are reachable from the entry. Traverses nested namespace
     * dependencies in depth order to ensure correctness.
     */
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
        this.markModuleExportsUsed(info.targetFile, visitedFiles, context);
      } else if (info.externalModule && info.externalImportName) {
        this.usedExternals.add(`${info.externalModule}:${info.externalImportName}`);
      }
    }
  }

  private getNamespaceExportDepth(
    entry: { name: string; sourceFile: string },
    depthCache: Map<string, number>,
  ): number {
    /**
     * Compute depth for a namespace export to enable sorting exports so
     * deeper (dependent) exports are processed after their children.
     */
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

  private markModuleExportsUsed(filePath: string, visitedFiles: Set<string>, context: "global" | "nonGlobal"): void {
    /**
     * Mark all exported declarations from `filePath` that should be included
     * in the bundle. Recursively follows star exports and namespace
     * exports, and records external imports encountered.
     */
    if (visitedFiles.has(filePath)) return;
    visitedFiles.add(filePath);

    const exportedNames = this.registry.exportedNamesByFile.get(filePath) ?? [];

    const fileDeclarations = this.registry.declarationsByFile.get(filePath);
    if (fileDeclarations) {
      for (const declId of fileDeclarations) {
        const declaration = this.registry.getDeclaration(declId);
        if (!declaration) continue;
        if (!declaration.isFromInlinedLibrary) continue;
        if (ts.isModuleDeclaration(declaration.node)) continue;
        if (!declaration.exportInfo.wasOriginallyExported && !ts.isVariableStatement(declaration.node)) {
          continue;
        }
        this.markUsed(declId, context);
      }
    }

    for (const starExport of this.registry.getStarExports(filePath)) {
      if (starExport.targetFile) {
        this.markModuleExportsUsed(starExport.targetFile, visitedFiles, context);
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
      this.markDeclarationsUsedByName(declFile, declName, context);

      const namespaceInfo = this.registry.getNamespaceExportInfo(filePath, exported.name);
      if (namespaceInfo?.targetFile) {
        this.markModuleExportsUsed(namespaceInfo.targetFile, visitedFiles, context);
      } else if (namespaceInfo?.externalModule && namespaceInfo.externalImportName) {
        this.usedExternals.add(`${namespaceInfo.externalModule}:${namespaceInfo.externalImportName}`);
      }
    }
  }

  private markEntryStarExportsUsed(context: "global" | "nonGlobal"): void {
    /**
     * Include declarations reachable from `export * from` entries that are
     * originated by the entry file.
     */
    if (this.registry.entryStarExports.length === 0) return;
    const visitedFiles = new Set<string>();

    for (const entry of this.registry.entryStarExports) {
      if (entry.info.targetFile) {
        this.markModuleExportsUsed(entry.info.targetFile, visitedFiles, context);
      }
    }
  }

  private markEntryNamedExportsUsed(entryFile: string, context: "global" | "nonGlobal"): void {
    /**
     * Mark declarations referenced by named exports from the entry file as
     * used. Handles re-exported externals and default export resolution.
     */
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
      this.markDeclarationsUsedByName(declFile, declName, context);

      if (declFile !== entryFile) {
        this.markDeclarationsUsedByName(entryFile, exported.name, context);
      }
    }
  }

  private markEntryExportAssignmentsUsed(entryFile: string, context: "global" | "nonGlobal"): void {
    /**
     * Inspect `export =` and `export default` assignment statements in
     * the entry AST and include referenced declarations/imports.
     */
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
          this.markDeclarationsUsedByName(importInfo.sourceFile, originalName, context);
        }
        continue;
      }

      this.markDeclarationsUsedByName(entryFile, exportName, context);
    }
  }

  private shouldSkipTypeOnlyImportExport(sourceFile: string, name: string): boolean {
    /**
     * Decide whether an import that is type-only should be skipped when
     * referenced from an export assignment. This prevents emitting purely
     * type-only imports when they are intentionally removed by
     * configuration or analysis.
     */
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
    /**
     * Return the local name of the default export declared in `sourceFile`,
     * or null if there is no default export declaration.
     */
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

  private markDeclarationsUsedByName(sourceFile: string, name: string, context: "global" | "nonGlobal"): void {
    /**
     * Mark all declarations by `sourceFile` and `name` as used. If a
     * declaration is a module/global declaration, it will be marked in the
     * global context regardless of the requested `context`.
     */
    const declIds = this.registry.getDeclarationIds(sourceFile, name);
    if (!declIds) return;
    for (const declId of declIds) {
      const declaration = this.registry.getDeclaration(declId);
      if (!declaration) continue;
      const effectiveContext = TreeShaker.isGlobalDeclaration(declaration) ? "global" : context;
      this.markUsed(declId, effectiveContext);
    }
  }

  private static isGlobalDeclaration(declaration: TypeDeclaration): boolean {
    /**
     * Determine whether a declaration is a global augmentation (inside
     * `declare global {}`) so it should be treated in the global context
     * for inclusion decisions.
     */
    if (!ts.isModuleDeclaration(declaration.node)) return false;
    // eslint-disable-next-line no-bitwise
    return (declaration.node.flags & ts.NodeFlags.GlobalAugmentation) !== 0;
  }
}
