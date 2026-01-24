import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { findTsConfig, getCompilerOptions } from "./helpers/typescript-config.js";
import { getLibraryName } from "./helpers/node-modules.js";

interface FileCollectorOptions {
  inlinedLibraries?: string[];
}

export interface CollectedFile {
  content: string;
  sourceFile: ts.SourceFile;
  isEntry: boolean;
  hasEmptyExport: boolean;
  referencedTypes: Set<string>;
}

export class FileCollector {
  private inlinedLibraries: string[];
  private program: ts.Program;
  private typeChecker: ts.TypeChecker;
  private entryFile: string;
  private inlinedLibrariesSet: Set<string>;

  constructor(entryFile: string, options: FileCollectorOptions = {}) {
    this.entryFile = path.resolve(entryFile);
    this.inlinedLibraries = options.inlinedLibraries ?? [];
    this.program = this.createProgram();
    this.typeChecker = this.program.getTypeChecker();
    
    // Compute transitive closure of inlined libraries
    this.inlinedLibrariesSet = this.computeInlinedLibrariesSet();
  }

  private createProgram(): ts.Program {
    // Find and parse tsconfig.json
    const configPath = findTsConfig(this.entryFile);
    const compilerOptions = getCompilerOptions(configPath);

    // Ensure declaration is enabled
    compilerOptions.declaration = true;

    // Create program with the entry file
    return ts.createProgram([this.entryFile], compilerOptions);
  }

  /**
   * Compute the transitive closure of libraries that should be inlined.
   * If library A is in inlinedLibraries and it imports from library B,
   * then library B should also be inlined (unless it's external).
   */
  private computeInlinedLibrariesSet(): Set<string> {
    const inlined = new Set<string>(this.inlinedLibraries);
    const toProcess = [...this.inlinedLibraries];
    const processed = new Set<string>();

    while (toProcess.length > 0) {
      const libName = toProcess.shift();
      if (!libName || processed.has(libName)) {
        continue;
      }
      processed.add(libName);

      // Find all source files from this library
      const sourceFiles = this.program.getSourceFiles();
      for (const sourceFile of sourceFiles) {
        const fileLibName = getLibraryName(sourceFile.fileName);
        
        // Check if this file belongs to the library we're processing
        // OR if it contains ambient module declarations for this library
        let shouldProcessFile = fileLibName === libName;
        
        if (!shouldProcessFile) {
          // Check for ambient module declarations
          for (const statement of sourceFile.statements) {
            if (ts.isModuleDeclaration(statement)) {
              const moduleName = statement.name.text;
              if (moduleName === libName) {
                shouldProcessFile = true;
                break;
              }
            }
          }
        }
        
        if (!shouldProcessFile) {
          continue;
        }

        // Check all imports in this file and in ambient modules
        for (const statement of sourceFile.statements) {
          let importPath: string | null = null;

          // Handle ambient module declarations
          if (ts.isModuleDeclaration(statement) && statement.body && ts.isModuleBlock(statement.body)) {
            // Check imports inside the ambient module
            for (const moduleStatement of statement.body.statements) {
              if (ts.isImportDeclaration(moduleStatement)) {
                const moduleSpecifier = moduleStatement.moduleSpecifier;
                if (ts.isStringLiteral(moduleSpecifier)) {
                  const nestedImport = moduleSpecifier.text;
                  if (!nestedImport.startsWith(".")) {
                    const importedLib = nestedImport.split("/")[0];
                    const importedLibName = importedLib.startsWith("@")
                      ? `${importedLib}/${nestedImport.split("/")[1]}`
                      : importedLib;
                    if (!inlined.has(importedLibName)) {
                      inlined.add(importedLibName);
                      toProcess.push(importedLibName);
                    }
                  }
                }
              }
            }
          }

          if (ts.isImportDeclaration(statement)) {
            const moduleSpecifier = statement.moduleSpecifier;
            if (ts.isStringLiteral(moduleSpecifier)) {
              importPath = moduleSpecifier.text;
            }
          } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
            if (ts.isStringLiteral(statement.moduleSpecifier)) {
              importPath = statement.moduleSpecifier.text;
            }
          } else if (ts.isImportEqualsDeclaration(statement)) {
            if (ts.isExternalModuleReference(statement.moduleReference)) {
              const expr = statement.moduleReference.expression;
              if (ts.isStringLiteral(expr)) {
                importPath = expr.text;
              }
            }
          }

          // If this is an import from another library (not relative)
          if (importPath && !importPath.startsWith(".")) {
            // Extract the library name from the import path
            const importedLib = importPath.split("/")[0];
            const importedLibName = importedLib.startsWith("@") ? `${importedLib}/${importPath.split("/")[1]}` : importedLib;

            // If we haven't already marked this library for inlining, add it
            if (!inlined.has(importedLibName)) {
              inlined.add(importedLibName);
              toProcess.push(importedLibName);
            }
          }
        }
      }
    }

    return inlined;
  }

  shouldInline(importPath: string): boolean {
    if (importPath.startsWith(".")) {
      return true;
    }
    return this.inlinedLibraries.some((lib) => importPath === lib || importPath.startsWith(`${lib}/`));
  }

  private shouldInlineFile(sourceFile: ts.SourceFile): boolean {
    const fileName = sourceFile.fileName;

    // Always include the entry file
    if (fileName === this.entryFile) {
      return true;
    }

    // Don't include default library files
    if (this.program.isSourceFileDefaultLibrary(sourceFile)) {
      return false;
    }

    // Check if file is from node_modules
    const libraryName = getLibraryName(fileName);
    
    if (libraryName === null) {
      // Not from node_modules - it's a local file, include it
      return true;
    }

    // Check if this library should be inlined
    if (this.inlinedLibrariesSet.has(libraryName)) {
      return true;
    }

    // Check for ambient module declarations that match inlined libraries
    // For example, @types/fake-node might declare module 'fake-fs'
    for (const statement of sourceFile.statements) {
      if (ts.isModuleDeclaration(statement)) {
        const moduleName = statement.name.text;
        if (this.inlinedLibrariesSet.has(moduleName)) {
          return true;
        }
      }
    }

    return false;
  }

  getProgram(): ts.Program {
    return this.program;
  }

  getTypeChecker(): ts.TypeChecker {
    return this.typeChecker;
  }

  /**
   * Resolve an import path from a given source file
   * Uses the TypeScript Program's module resolution
   */
  resolveImport(fromFile: string, importPath: string): string | null {
    // For relative imports, we can use simple path resolution
    if (importPath.startsWith(".")) {
      const dir = path.dirname(fromFile);
      const resolved = path.resolve(dir, importPath);

      const extensions = [
        "",
        ".ts",
        ".tsx",
        ".d.ts",
        ".mts",
        ".cts",
        ".d.mts",
        ".d.cts",
        "/index.ts",
        "/index.tsx",
        "/index.d.ts",
        "/index.mts",
        "/index.d.mts",
        "/index.cts",
        "/index.d.cts",
      ];

      for (const ext of extensions) {
        const fullPath = resolved + ext;
        if (fs.existsSync(fullPath)) {
          return fullPath;
        }
      }

      return null;
    }

    // For non-relative imports, find the source file in the program
    // TypeScript has already resolved these for us
    const sourceFiles = this.program.getSourceFiles();
    for (const sourceFile of sourceFiles) {
      // Check if this source file is from the imported module
      const fileName = sourceFile.fileName;
      
      // Handle node_modules imports
      if (fileName.includes("node_modules")) {
        const libName = getLibraryName(fileName);
        if (libName === importPath || fileName.includes(`/${importPath}/`)) {
          return fileName;
        }
      }
    }

    return null;
  }

  collectFiles(): Map<string, CollectedFile> {
    const files = new Map<string, CollectedFile>();
    const sourceFiles = this.program.getSourceFiles();

    for (const sourceFile of sourceFiles) {
      // Skip files we shouldn't inline
      if (!this.shouldInlineFile(sourceFile)) {
        continue;
      }

      const filePath = sourceFile.fileName;
      const isEntry = filePath === this.entryFile;

      // Read file content
      let content: string;
      if (fs.existsSync(filePath)) {
        content = fs.readFileSync(filePath, "utf-8");
      } else {
        // For ambient modules, use the source file text
        content = sourceFile.text;
      }

      // Check for empty export
      const hasEmptyExport = sourceFile.statements.some((statement) => {
        if (!ts.isExportDeclaration(statement)) return false;
        if (statement.moduleSpecifier) return false;
        if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) return false;
        return statement.exportClause.elements.length === 0;
      });

      // Extract triple-slash reference directives with preserve="true" or preserve='true'
      const referencedTypes = new Set<string>();
      const typeRefs = (
        sourceFile as ts.SourceFile & { typeReferenceDirectives: Array<{ fileName: string; preserve?: boolean }> }
      ).typeReferenceDirectives;
      for (const ref of typeRefs) {
        if (ref.preserve === true) {
          referencedTypes.add(ref.fileName);
        }
      }

      files.set(filePath, { content, sourceFile, isEntry, hasEmptyExport, referencedTypes });
    }

    return files;
  }
}
