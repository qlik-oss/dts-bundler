import type ts from "typescript";

export interface BundleTypesOptions {
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
   * Whether to inline declare module blocks for external modules
   */
  inlineDeclareExternals?: boolean;

  /**
   * Whether to export referenced types automatically
   */
  exportReferencedTypes?: boolean;

  /**
   * Whether to only include entry exports during tree-shaking
   */
  entryExportsOnly?: boolean;

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
  isTypeOnly?: boolean;
}

export enum ExportKind {
  NotExported = "NOT_EXPORTED",
  Named = "NAMED",
  NamedAndDefault = "NAMED_AND_DEFAULT",
  Default = "DEFAULT",
  DefaultOnly = "DEFAULT_ONLY",
  Equals = "EQUALS",
}

export interface ExportInfo {
  kind: ExportKind;
  wasOriginallyExported: boolean;
}

export interface ExportedNameInfo {
  name: string;
  originalName?: string;
  sourceFile?: string;
  externalModule?: string;
  externalImportName?: string;
  exportFrom?: boolean;
  isTypeOnly?: boolean;
}

export interface NamespaceExportInfo {
  name: string;
  targetFile?: string;
  externalModule?: string;
  externalImportName?: string;
}

export interface EntryNamespaceExport {
  name: string;
  sourceFile: string;
}

export interface StarExportInfo {
  targetFile?: string;
  externalModule?: string;
  isTypeOnly?: boolean;
}

export interface EntryStarExport {
  sourceFile: string;
  info: StarExportInfo;
}

export class TypeDeclaration {
  public readonly id: symbol;
  public name: string;
  public normalizedName: string;
  public sourceFile: string;
  public node: ts.Node;
  public sourceFileNode: ts.SourceFile;
  public exportInfo: ExportInfo;
  public isTypeOnly: boolean;
  public dependencies: Set<symbol>;
  public externalDependencies: Map<string, Set<string>>;
  public namespaceDependencies: Set<string>; // Track which namespaces this declaration depends on
  public importAliases: Map<string, { sourceFile: string; originalName: string; qualifiedName?: string }>; // Track alias -> original mapping
  public variableDeclaration?: ts.VariableDeclaration;
  public forceInclude: boolean;
  public mergeGroup: string | null;
  private text: string | null;

  constructor(
    name: string,
    sourceFilePath: string,
    node: ts.Node,
    sourceFileNode: ts.SourceFile,
    exportInfo: ExportInfo,
  ) {
    this.id = Symbol(name);
    this.name = name;
    this.normalizedName = name;
    this.sourceFile = sourceFilePath;
    this.node = node;
    this.sourceFileNode = sourceFileNode;
    this.exportInfo = exportInfo;
    this.isTypeOnly = false;
    this.dependencies = new Set();
    this.externalDependencies = new Map();
    this.namespaceDependencies = new Set();
    this.importAliases = new Map();
    this.forceInclude = false;
    this.mergeGroup = null;
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
  public isDefaultImport: boolean;
  public isValueUsage: boolean;
  public typesLibraryName: string | null;

  constructor(
    moduleName: string,
    importName: string,
    isTypeOnly = false,
    isDefaultImport = false,
    typesLibraryName: string | null = null,
  ) {
    this.moduleName = moduleName;
    this.originalName = importName;
    this.normalizedName = importName;
    this.isTypeOnly = isTypeOnly;
    this.isDefaultImport = isDefaultImport;
    this.isValueUsage = false;
    this.typesLibraryName = typesLibraryName;
  }
}
