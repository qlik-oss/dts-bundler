import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { getLibraryName } from "./helpers/node-modules.js";
import { findTsConfig, getCompilerOptions } from "./helpers/typescript-config.js";

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
    // Simply return the explicitly configured inlined libraries
    // Do not compute transitive dependencies - only inline what's explicitly requested
    return new Set<string>(this.inlinedLibraries);
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
   * Check if a given file path belongs to an inlined library
   */
  isFromInlinedLibrary(filePath: string): boolean {
    const libraryName = getLibraryName(filePath);
    return libraryName !== null && this.inlinedLibrariesSet.has(libraryName);
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

      // Handle .mjs, .cjs, .js extensions mapping to TypeScript equivalents
      const basePaths = [resolved];
      if (importPath.endsWith(".mjs")) {
        basePaths.push(resolved.slice(0, -4));
      }
      if (importPath.endsWith(".cjs")) {
        basePaths.push(resolved.slice(0, -4));
      }
      if (importPath.endsWith(".js")) {
        basePaths.push(resolved.slice(0, -3));
      }

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

      for (const base of basePaths) {
        for (const ext of extensions) {
          const fullPath = base + ext;
          if (fs.existsSync(fullPath)) {
            return fullPath;
          }
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
    const processedPaths = new Set<string>();

    // First, collect files that TypeScript's Program resolved
    for (const sourceFile of sourceFiles) {
      // Skip files we shouldn't inline
      if (!this.shouldInlineFile(sourceFile)) {
        continue;
      }

      const filePath = sourceFile.fileName;
      processedPaths.add(filePath);
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

    // Second pass: manually collect relative imports that TypeScript might have missed
    // This handles cases like ./file.mjs importing file.mts
    const toProcess: Array<{ file: string; isEntry: boolean }> = [{ file: this.entryFile, isEntry: true }];

    while (toProcess.length > 0) {
      const next = toProcess.shift();
      if (!next) break;
      const { file: filePath, isEntry } = next;

      // Skip if already processed
      if (processedPaths.has(filePath)) {
        continue;
      }

      if (!fs.existsSync(filePath)) {
        continue;
      }

      processedPaths.add(filePath);

      const content = fs.readFileSync(filePath, "utf-8");
      const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);

      const hasEmptyExport = sourceFile.statements.some((statement) => {
        if (!ts.isExportDeclaration(statement)) return false;
        if (statement.moduleSpecifier) return false;
        if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) return false;
        return statement.exportClause.elements.length === 0;
      });

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

      // Collect relative imports
      for (const statement of sourceFile.statements) {
        if (ts.isImportDeclaration(statement)) {
          const moduleSpecifier = statement.moduleSpecifier;
          if (ts.isStringLiteral(moduleSpecifier)) {
            const importPath = moduleSpecifier.text;
            if (this.shouldInline(importPath)) {
              const resolved = this.resolveImport(filePath, importPath);
              if (resolved && !processedPaths.has(resolved)) {
                toProcess.push({ file: resolved, isEntry: false });
              }
            }
          }
        } else if (ts.isImportEqualsDeclaration(statement)) {
          if (ts.isExternalModuleReference(statement.moduleReference)) {
            const expr = statement.moduleReference.expression;
            if (ts.isStringLiteral(expr)) {
              const importPath = expr.text;
              if (this.shouldInline(importPath)) {
                const resolved = this.resolveImport(filePath, importPath);
                if (resolved && !processedPaths.has(resolved)) {
                  toProcess.push({ file: resolved, isEntry: false });
                }
              }
            }
          }
        } else if (ts.isExportDeclaration(statement)) {
          const moduleSpecifier = statement.moduleSpecifier;
          if (moduleSpecifier && ts.isStringLiteral(moduleSpecifier)) {
            const exportPath = moduleSpecifier.text;
            if (this.shouldInline(exportPath)) {
              const resolved = this.resolveImport(filePath, exportPath);
              if (resolved && !processedPaths.has(resolved)) {
                toProcess.push({ file: resolved, isEntry: false });
              }
            }
          }
        }
      }
    }

    return files;
  }
}
