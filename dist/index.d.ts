import ts from "typescript";

//#region src/types.d.ts
interface BundleDtsOptions {
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
//#endregion
//#region src/index.d.ts
/**
 * Bundle TypeScript declaration files
 * @param options - Bundling options
 * @returns The bundled TypeScript declaration content
 */
declare function bundleDts(options: BundleDtsOptions): string;
//#endregion
export { bundleDts };