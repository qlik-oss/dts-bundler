import type {
  EntryNamespaceExport,
  EntryStarExport,
  ExportedNameInfo,
  NamespaceExportInfo,
  StarExportInfo,
  TypeDeclaration,
} from "./types";
import { ExportKind, ExternalImport } from "./types";

export class TypeRegistry {
  public declarations: Map<symbol, TypeDeclaration>;
  public declarationsByFile: Map<string, Set<symbol>>;
  public nameIndex: Map<string, Set<symbol>>;
  public externalImports: Map<string, Map<string, ExternalImport>>;
  public namespaceImports: Map<string, { namespaceName: string; sourceFile: string }>;
  public exportedNamesByFile: Map<string, ExportedNameInfo[]>;
  public namespaceExportsByFile: Map<string, Map<string, NamespaceExportInfo>>;
  public entryNamespaceExports: EntryNamespaceExport[];
  public starExportsByFile: Map<string, StarExportInfo[]>;
  public entryStarExports: EntryStarExport[];

  /**
   * Central registry storing discovered type declarations, external import
   * metadata, and export information gathered during analysis.
   *
   * The registry acts as the primary shared datastore used by the various
   * analysis and emission phases.
   */
  constructor() {
    this.declarations = new Map();
    this.declarationsByFile = new Map();
    this.nameIndex = new Map();
    this.externalImports = new Map();
    this.namespaceImports = new Map();
    this.exportedNamesByFile = new Map();
    this.namespaceExportsByFile = new Map();
    this.entryNamespaceExports = [];
    this.starExportsByFile = new Map();
    this.entryStarExports = [];
  }

  register(declaration: TypeDeclaration): void {
    this.declarations.set(declaration.id, declaration);

    if (!this.declarationsByFile.has(declaration.sourceFile)) {
      this.declarationsByFile.set(declaration.sourceFile, new Set());
    }
    this.declarationsByFile.get(declaration.sourceFile)?.add(declaration.id);

    const key = `${declaration.sourceFile}:${declaration.name}`;
    const existing = this.nameIndex.get(key);
    if (existing) {
      existing.add(declaration.id);
    } else {
      this.nameIndex.set(key, new Set([declaration.id]));
    }
  }

  /**
   * Register a discovered external import and return a canonical `ExternalImport` instance.
   * - `moduleName`: package/module specifier (e.g. 'lodash').
   * - `importName`: original import text (e.g. 'default as Foo' or 'Bar').
   * - `isTypeOnly`: whether the import is type-only.
   */
  registerExternal(
    moduleName: string,
    importName: string,
    isTypeOnly: boolean,
    isDefaultImport = false,
    typesLibraryName: string | null = null,
  ): ExternalImport {
    if (!this.externalImports.has(moduleName)) {
      this.externalImports.set(moduleName, new Map());
    }

    const moduleImports = this.externalImports.get(moduleName) as Map<string, ExternalImport>;
    if (!moduleImports.has(importName)) {
      moduleImports.set(
        importName,
        new ExternalImport(moduleName, importName, isTypeOnly, isDefaultImport, typesLibraryName),
      );
    } else if (typesLibraryName) {
      const existing = moduleImports.get(importName);
      if (existing && !existing.typesLibraryName) {
        existing.typesLibraryName = typesLibraryName;
      }
      if (existing && !isTypeOnly) {
        existing.isTypeOnly = false;
      }
    }

    return moduleImports.get(importName) as ExternalImport;
  }

  markExternalValueUsage(moduleName: string, importName: string): void {
    const moduleImports = this.externalImports.get(moduleName);
    const existing = moduleImports?.get(importName) ?? null;
    if (existing) {
      existing.isValueUsage = true;
    }
  }

  /**
   * Record an exported name for `filePath`. Merges information if the same
   * exported name is encountered multiple times with complementary data.
   */
  registerExportedName(filePath: string, info: ExportedNameInfo): void {
    const list = this.exportedNamesByFile.get(filePath) ?? [];
    const existing = list.find((item) => item.name === info.name);
    if (!existing) {
      list.push(info);
      this.exportedNamesByFile.set(filePath, list);
      return;
    }

    if (!existing.originalName && info.originalName) {
      existing.originalName = info.originalName;
    }
    if (!existing.sourceFile && info.sourceFile) {
      existing.sourceFile = info.sourceFile;
    }
    if (!existing.externalModule && info.externalModule) {
      existing.externalModule = info.externalModule;
    }
    if (!existing.externalImportName && info.externalImportName) {
      existing.externalImportName = info.externalImportName;
    }
    if (!existing.exportFrom && info.exportFrom) {
      existing.exportFrom = info.exportFrom;
    }
    if (info.isTypeOnly !== undefined) {
      if (existing.isTypeOnly === undefined) {
        existing.isTypeOnly = info.isTypeOnly;
      } else {
        existing.isTypeOnly = existing.isTypeOnly && info.isTypeOnly;
      }
    }
  }

  /**
   * Register a namespace export (e.g. `export * as ns from '...'`) for a file.
   * Optionally also register the exported name into the exported-name index.
   */
  registerNamespaceExport(filePath: string, info: NamespaceExportInfo, registerExportedName = true): void {
    if (!this.namespaceExportsByFile.has(filePath)) {
      this.namespaceExportsByFile.set(filePath, new Map());
    }
    const fileMap = this.namespaceExportsByFile.get(filePath) as Map<string, NamespaceExportInfo>;
    if (!fileMap.has(info.name)) {
      fileMap.set(info.name, info);
    }
    if (registerExportedName) {
      this.registerExportedName(filePath, {
        name: info.name,
        externalModule: info.externalModule,
        externalImportName: info.externalImportName,
      });
    }

    if (info.externalModule && info.externalImportName) {
      this.markExternalValueUsage(info.externalModule, info.externalImportName);
    }
  }

  getNamespaceExportInfo(filePath: string, name: string): NamespaceExportInfo | null {
    const fileMap = this.namespaceExportsByFile.get(filePath);
    if (!fileMap) return null;
    return fileMap.get(name) ?? null;
  }

  /** Register a namespace export entry originating from the entry file. */
  registerEntryNamespaceExport(filePath: string, name: string): void {
    const exists = this.entryNamespaceExports.some((entry) => entry.name === name && entry.sourceFile === filePath);
    if (!exists) {
      this.entryNamespaceExports.push({ name, sourceFile: filePath });
    }
  }

  /**
   * Record a star export (`export * from '...'`) for `filePath`. If `isEntry`
   * is true, the star export is also tracked as an entry-originating star.
   */
  registerStarExport(filePath: string, info: StarExportInfo, isEntry: boolean): void {
    const list = this.starExportsByFile.get(filePath) ?? [];
    list.push(info);
    this.starExportsByFile.set(filePath, list);

    if (isEntry) {
      this.entryStarExports.push({ sourceFile: filePath, info });
    }
  }

  getStarExports(filePath: string): StarExportInfo[] {
    return this.starExportsByFile.get(filePath) ?? [];
  }

  /**
   * Lookup a declaration by local `name` within `fromFile` scope. Returns the
   * first matching `TypeDeclaration` or `null` if none found.
   */
  lookup(name: string, fromFile: string): TypeDeclaration | null {
    const localKey = `${fromFile}:${name}`;
    const ids = this.nameIndex.get(localKey);
    if (ids && ids.size > 0) {
      const id = ids.values().next().value as symbol | undefined;
      return id ? (this.declarations.get(id) ?? null) : null;
    }
    return null;
  }

  /** Return the set of declaration ids for the given key, or null. */
  getDeclarationIdsByKey(key: string): Set<symbol> | null {
    return this.nameIndex.get(key) ?? null;
  }

  /** Return the declaration id set for `sourceFile:name` or null. */
  getDeclarationIds(sourceFile: string, name: string): Set<symbol> | null {
    return this.getDeclarationIdsByKey(`${sourceFile}:${name}`);
  }

  /** Return whether any declarations exist for the provided key. */
  hasDeclarationKey(key: string): boolean {
    const ids = this.nameIndex.get(key);
    return Boolean(ids && ids.size > 0);
  }

  /** Return the first declaration id for `key` or null. */
  getFirstDeclarationIdByKey(key: string): symbol | null {
    const ids = this.nameIndex.get(key);
    if (!ids || ids.size === 0) return null;
    return ids.values().next().value as symbol | null;
  }

  /** Retrieve a declaration by its symbol id. */
  getDeclaration(id: symbol): TypeDeclaration | undefined {
    return this.declarations.get(id);
  }

  /** Return all declarations marked as exported. */
  getAllExported(): TypeDeclaration[] {
    return Array.from(this.declarations.values()).filter((d) => d.exportInfo.kind !== ExportKind.NotExported);
  }
}
