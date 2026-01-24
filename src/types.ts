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
  public isExportEquals: boolean; // True if exported via export = statement
  public isExportedAsDefault: boolean; // True if exported via export default statement
  public isExportedAsDefaultOnly: boolean; // True if exported only via export default statement
  public dependencies: Set<symbol>;
  public externalDependencies: Map<string, Set<string>>;
  public namespaceDependencies: Set<string>; // Track which namespaces this declaration depends on
  public variableDeclaration?: ts.VariableDeclaration;
  private text: string | null;

  constructor(
    name: string,
    sourceFilePath: string,
    node: ts.Node,
    sourceFileNode: ts.SourceFile,
    isExported = false,
    wasOriginallyExported = isExported,
  ) {
    this.id = Symbol(name);
    this.name = name;
    this.normalizedName = name;
    this.sourceFile = sourceFilePath;
    this.node = node;
    this.sourceFileNode = sourceFileNode;
    this.isExported = isExported;
    this.wasOriginallyExported = wasOriginallyExported;
    this.isExportEquals = false;
    this.isExportedAsDefault = false;
    this.isExportedAsDefaultOnly = false;
    this.dependencies = new Set();
    this.externalDependencies = new Map();
    this.namespaceDependencies = new Set();
    this.text = null;
  }

  getText(): string {
    if (this.text) return this.text;

    let text = this.node.getFullText(this.sourceFileNode);

    // Normalize indentation for declarations from ambient modules
    // Split into lines and find common leading whitespace
    const lines = text.split("\n");
    if (lines.length > 0) {
      // Find the minimum indentation across all non-empty lines
      let minIndent = Infinity;
      for (const line of lines) {
        if (line.trim().length === 0) continue;
        const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
        if (indent < minIndent) {
          minIndent = indent;
        }
      }

      // Remove the common indentation from all lines
      if (minIndent > 0 && minIndent !== Infinity) {
        text = lines
          .map((line) => {
            if (line.trim().length === 0) return "";
            return line.substring(minIndent);
          })
          .join("\n")
          .trim();
      } else {
        text = text.trim();
      }
    } else {
      text = text.trim();
    }

    // Convert tabs to spaces (2 spaces per tab) for consistent output
    text = text.replace(/\t/g, "  ");

    this.text = text;
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
