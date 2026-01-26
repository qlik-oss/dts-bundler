import type {
  EntryNamespaceExport,
  EntryStarExport,
  ExportedNameInfo,
  NamespaceExportInfo,
  StarExportInfo,
  TypeDeclaration,
} from "./types.js";
import { ExportKind, ExternalImport } from "./types.js";

export class TypeRegistry {
  public declarations: Map<symbol, TypeDeclaration>;
  public declarationsByFile: Map<string, Set<symbol>>;
  public nameIndex: Map<string, symbol>;
  public externalImports: Map<string, Map<string, ExternalImport>>;
  public namespaceImports: Map<string, { namespaceName: string; sourceFile: string }>;
  public exportedNamesByFile: Map<string, ExportedNameInfo[]>;
  public namespaceExportsByFile: Map<string, Map<string, NamespaceExportInfo>>;
  public entryNamespaceExports: EntryNamespaceExport[];
  public starExportsByFile: Map<string, StarExportInfo[]>;
  public entryStarExports: EntryStarExport[];

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
    this.nameIndex.set(key, declaration.id);
  }

  registerExternal(
    moduleName: string,
    importName: string,
    isTypeOnly: boolean,
    isDefaultImport = false,
  ): ExternalImport {
    if (!this.externalImports.has(moduleName)) {
      this.externalImports.set(moduleName, new Map());
    }

    const moduleImports = this.externalImports.get(moduleName) as Map<string, ExternalImport>;
    if (!moduleImports.has(importName)) {
      moduleImports.set(importName, new ExternalImport(moduleName, importName, isTypeOnly, isDefaultImport));
    }

    return moduleImports.get(importName) as ExternalImport;
  }

  registerExportedName(filePath: string, info: ExportedNameInfo): void {
    const list = this.exportedNamesByFile.get(filePath) ?? [];
    const existing = list.find((item) => item.name === info.name);
    if (!existing) {
      list.push(info);
      this.exportedNamesByFile.set(filePath, list);
      return;
    }

    if (!existing.externalModule && info.externalModule) {
      existing.externalModule = info.externalModule;
    }
    if (!existing.externalImportName && info.externalImportName) {
      existing.externalImportName = info.externalImportName;
    }
  }

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
  }

  getNamespaceExportInfo(filePath: string, name: string): NamespaceExportInfo | null {
    const fileMap = this.namespaceExportsByFile.get(filePath);
    if (!fileMap) return null;
    return fileMap.get(name) ?? null;
  }

  registerEntryNamespaceExport(filePath: string, name: string): void {
    const exists = this.entryNamespaceExports.some((entry) => entry.name === name && entry.sourceFile === filePath);
    if (!exists) {
      this.entryNamespaceExports.push({ name, sourceFile: filePath });
    }
  }

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

  lookup(name: string, fromFile: string): TypeDeclaration | null {
    const localKey = `${fromFile}:${name}`;
    if (this.nameIndex.has(localKey)) {
      const id = this.nameIndex.get(localKey) as symbol;
      return this.declarations.get(id) ?? null;
    }
    return null;
  }

  getDeclaration(id: symbol): TypeDeclaration | undefined {
    return this.declarations.get(id);
  }

  getAllExported(): TypeDeclaration[] {
    return Array.from(this.declarations.values()).filter((d) => d.exportInfo.kind !== ExportKind.NotExported);
  }
}
