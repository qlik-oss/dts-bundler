import type { TypeDeclaration } from "./types.js";
import { ExportKind, ExternalImport } from "./types.js";

export class TypeRegistry {
  public declarations: Map<symbol, TypeDeclaration>;
  public declarationsByFile: Map<string, Set<symbol>>;
  public nameIndex: Map<string, symbol>;
  public externalImports: Map<string, Map<string, ExternalImport>>;
  public namespaceImports: Map<string, { namespaceName: string; sourceFile: string }>;

  constructor() {
    this.declarations = new Map();
    this.declarationsByFile = new Map();
    this.nameIndex = new Map();
    this.externalImports = new Map();
    this.namespaceImports = new Map();
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

  registerExternal(moduleName: string, importName: string, isTypeOnly: boolean): ExternalImport {
    if (!this.externalImports.has(moduleName)) {
      this.externalImports.set(moduleName, new Map());
    }

    const moduleImports = this.externalImports.get(moduleName) as Map<string, ExternalImport>;
    if (!moduleImports.has(importName)) {
      moduleImports.set(importName, new ExternalImport(moduleName, importName, isTypeOnly));
    }

    return moduleImports.get(importName) as ExternalImport;
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
