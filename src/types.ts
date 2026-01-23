import type ts from "typescript";

export interface BundleDtsOptions {
  /**
   * Entry TypeScript file path
   */
  entry: string;

  /**
   * Array of library names to inline (optional)
   * @default []
   */
  inlinedLibraries?: string[];

  /**
   * Array of @types library names that should be referenced via triple-slash directives
   * @default undefined
   */
  allowedTypesLibraries?: string[];

  /**
   * Array of library names that should remain as regular imports
   * @default undefined
   */
  importedLibraries?: string[];

  /**
   * Whether to inline declare global blocks
   */
  inlineDeclareGlobals?: boolean;

  /**
   * Whether to export referenced types automatically
   */
  exportReferencedTypes?: boolean;

  /**
   * Whether to include a banner in output
   */
  noBanner?: boolean;

  /**
   * Whether to sort nodes alphabetically
   */
  sortNodes?: boolean;

  /**
   * UMD module name to output
   */
  umdModuleName?: string;

  /**
   * Preserve const enums
   */
  respectPreserveConstEnum?: boolean;
}

export interface ImportInfo {
  originalName: string;
  sourceFile: string | null;
  isExternal: boolean;
  aliasName?: string | null;
}

export class TypeDeclaration {
  public readonly id: symbol;
  public name: string;
  public normalizedName: string;
  public sourceFile: string;
  public node: ts.Node;
  public sourceFileNode: ts.SourceFile;
  public isExported: boolean;
  public wasOriginallyExported: boolean;
  public dependencies: Set<symbol>;
  public externalDependencies: Map<string, Set<string>>;
  public namespaceDependencies: Set<string>; // Track which namespaces this declaration depends on
  private text: string | null;

  constructor(name: string, sourceFilePath: string, node: ts.Node, sourceFileNode: ts.SourceFile, isExported = false) {
    this.id = Symbol(name);
    this.name = name;
    this.normalizedName = name;
    this.sourceFile = sourceFilePath;
    this.node = node;
    this.sourceFileNode = sourceFileNode;
    this.isExported = isExported;
    this.wasOriginallyExported = isExported;
    this.dependencies = new Set();
    this.externalDependencies = new Map();
    this.namespaceDependencies = new Set();
    this.text = null;
  }

  getText(): string {
    if (this.text) return this.text;

    this.text = this.node.getFullText(this.sourceFileNode).trim();
    return this.text;
  }
}

export class ExternalImport {
  public moduleName: string;
  public originalName: string;
  public normalizedName: string;
  public isTypeOnly: boolean;

  constructor(moduleName: string, importName: string, isTypeOnly = false) {
    this.moduleName = moduleName;
    this.originalName = importName;
    this.normalizedName = importName;
    this.isTypeOnly = isTypeOnly;
  }
}
