import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const parseConfigHost: ts.ParseConfigHost = {
  useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
  readDirectory: ts.sys.readDirectory,
  fileExists: ts.sys.fileExists,
  readFile: ts.sys.readFile,
};

/**
 * Find tsconfig.json for a given input file by walking up the directory tree
 * @param inputFile - The input TypeScript file
 * @returns Path to the tsconfig.json file
 */
export function findTsConfig(inputFile: string): string {
  const absolutePath = path.resolve(inputFile);
  let currentDir = path.dirname(absolutePath);

  // Walk up the directory tree looking for tsconfig.json
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (true) {
    const configPath = path.join(currentDir, "tsconfig.json");
    if (fs.existsSync(configPath)) {
      return configPath;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      // Reached root, no tsconfig found
      throw new Error(`Cannot find tsconfig.json for file: ${inputFile}`);
    }
    currentDir = parentDir;
  }
}

/**
 * Get TypeScript compiler options from a tsconfig file
 * @param configPath - Path to tsconfig.json
 * @returns Parsed compiler options
 */
export function getCompilerOptions(configPath: string): ts.CompilerOptions {
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);

  if (configFile.error) {
    throw new Error(`Error reading tsconfig.json: ${configFile.error.messageText}`);
  }

  const parsedConfig = ts.parseJsonConfigFileContent(
    configFile.config,
    parseConfigHost,
    path.dirname(configPath),
    undefined,
    configPath,
  );

  if (parsedConfig.errors.length > 0) {
    const errors = parsedConfig.errors
      .filter((d) => d.code !== 18003) // Ignore "No inputs found" error
      .map((d) => d.messageText)
      .join("\n");

    if (errors) {
      throw new Error(`Error parsing tsconfig.json: ${errors}`);
    }
  }

  return parsedConfig.options;
}
