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
}

/**
 * Bundle TypeScript declaration files into a single file
 * @param {BundleDtsOptions} options - Bundling options
 * @returns The bundled TypeScript declaration content as a string
 * @throws {Error} When entry option is missing or entry file does not exist
 */
export function bundleDts(options: BundleDtsOptions): string;
