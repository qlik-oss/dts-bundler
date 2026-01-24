/**
 * Helper functions for working with node_modules paths and library names
 * Ported from dts-bundle-generator
 */

const nodeModulesFolderName = "node_modules/";
const libraryNameRegex = /node_modules\/((?:(?=@)[^/]+\/[^/]+|[^/]+))\//;

/**
 * Extract library name from a file path that contains node_modules
 * @param fileName - File path that may contain node_modules
 * @returns Library name (e.g., "typescript", "@types/node") or null if not in node_modules
 */
export function getLibraryName(fileName: string): string | null {
  const lastNodeModulesIndex = fileName.lastIndexOf(nodeModulesFolderName);
  if (lastNodeModulesIndex === -1) {
    return null;
  }

  const match = libraryNameRegex.exec(fileName.slice(lastNodeModulesIndex));
  if (match === null) {
    return null;
  }

  return match[1];
}

/**
 * Extract the types library name from a path in @types folder
 * @param filePath - Path that may be in @types
 * @returns Library name without @types/ prefix, or null
 */
export function getTypesLibraryName(filePath: string): string | null {
  const libraryName = getLibraryName(filePath);
  if (libraryName === null) {
    return null;
  }

  const typesFolderPrefix = "@types/";
  if (!libraryName.startsWith(typesFolderPrefix)) {
    return null;
  }

  return libraryName.substring(typesFolderPrefix.length);
}
