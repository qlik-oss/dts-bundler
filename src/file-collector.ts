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
  private modulePathCache: Map<string, string>;
  private moduleFilesByLibrary: Map<string, string[]>;
  private moduleResolveCache: Map<string, string | null>;

  constructor(entryFile: string, options: FileCollectorOptions = {}) {
    this.entryFile = path.resolve(entryFile);
    this.inlinedLibraries = options.inlinedLibraries ?? [];
    this.program = this.createProgram();
    this.typeChecker = this.program.getTypeChecker();

    // Compute transitive closure of inlined libraries
    this.inlinedLibrariesSet = this.computeInlinedLibrariesSet();

    this.modulePathCache = new Map();
    this.moduleFilesByLibrary = new Map();
    this.moduleResolveCache = new Map();
    this.buildModuleCaches();
  }

  private createProgram(): ts.Program {
    // Find and parse tsconfig.json
    const configPath = findTsConfig(this.entryFile);
    const compilerOptions = getCompilerOptions(configPath);

    const entryExt = path.extname(this.entryFile).toLowerCase();
    if (entryExt === ".cts" || entryExt === ".mts" || entryExt === ".cjs" || entryExt === ".mjs") {
      compilerOptions.moduleResolution = ts.ModuleResolutionKind.NodeNext;
      if (compilerOptions.module === undefined) {
        compilerOptions.module = ts.ModuleKind.NodeNext;
      }
    }

    // Ensure declaration is enabled
    compilerOptions.declaration = true;

    // Performance: skip type checking of libs
    compilerOptions.skipLibCheck = true;
    compilerOptions.skipDefaultLibCheck = true;

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

  private buildModuleCaches(): void {
    for (const sourceFile of this.program.getSourceFiles()) {
      const fileName = sourceFile.fileName;

      if (!fileName.includes("node_modules")) {
        continue;
      }

      const libName = getLibraryName(fileName);
      if (!libName) {
        continue;
      }

      if (!this.modulePathCache.has(libName)) {
        this.modulePathCache.set(libName, fileName);
      }

      const list = this.moduleFilesByLibrary.get(libName);
      if (list) {
        list.push(fileName);
      } else {
        this.moduleFilesByLibrary.set(libName, [fileName]);
      }
    }
  }

  private static getLibraryNameFromImportPath(importPath: string): string {
    if (importPath.startsWith("@")) {
      const parts = importPath.split("/");
      return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : importPath;
    }
    const [first] = importPath.split("/");
    return first;
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

  getCompilerOptions(): ts.CompilerOptions {
    return this.program.getCompilerOptions();
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

      // Handle arbitrary extensions (TypeScript 5.0+)
      // For imports like './hello.json', look for './hello.d.json.ts'
      const lastDotIndex = importPath.lastIndexOf(".");
      if (lastDotIndex > 0 && lastDotIndex > importPath.lastIndexOf("/")) {
        const ext = importPath.substring(lastDotIndex);
        if (![".ts", ".tsx", ".js", ".mjs", ".cjs", ".mts", ".cts"].includes(ext)) {
          const arbitraryDeclPath = `${resolved}.d${ext}.ts`;
          if (fs.existsSync(arbitraryDeclPath)) {
            return arbitraryDeclPath;
          }
        }
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

    const cached = this.moduleResolveCache.get(importPath);
    if (cached !== undefined) {
      return cached;
    }

    const direct = this.modulePathCache.get(importPath);
    if (direct) {
      this.moduleResolveCache.set(importPath, direct);
      return direct;
    }

    const libraryName = FileCollector.getLibraryNameFromImportPath(importPath);
    const list = this.moduleFilesByLibrary.get(libraryName);

    if (list) {
      const match = list.find(
        (fileName) =>
          fileName.includes(`/${importPath}/`) ||
          fileName.includes(`/${importPath}.`) ||
          fileName.endsWith(`/${importPath}`),
      );
      if (match) {
        this.moduleResolveCache.set(importPath, match);
        return match;
      }
    }

    this.moduleResolveCache.set(importPath, null);
    return null;
  }

  collectFiles(): Map<string, CollectedFile> {
    const files = new Map<string, CollectedFile>();
    const sourceFiles = this.program.getSourceFiles();

    const createCollectedFile = (sourceFile: ts.SourceFile, isEntry: boolean): CollectedFile => {
      const filePath = sourceFile.fileName;

      let content: string;
      if (fs.existsSync(filePath)) {
        content = fs.readFileSync(filePath, "utf-8");
      } else {
        content = sourceFile.text;
      }

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

      return { content, sourceFile, isEntry, hasEmptyExport, referencedTypes };
    };

    // First, collect files that TypeScript's Program resolved
    for (const sourceFile of sourceFiles) {
      // Skip files we shouldn't inline
      if (!this.shouldInlineFile(sourceFile)) {
        continue;
      }

      const filePath = sourceFile.fileName;
      const isEntry = filePath === this.entryFile;
      files.set(filePath, createCollectedFile(sourceFile, isEntry));
    }

    const queue = Array.from(files.keys());
    while (queue.length > 0) {
      const currentPath = queue.shift();
      if (!currentPath) continue;
      const current = files.get(currentPath);
      if (!current) continue;

      for (const statement of current.sourceFile.statements) {
        let moduleSpecifier: ts.Expression | undefined;
        if (ts.isImportDeclaration(statement)) {
          moduleSpecifier = statement.moduleSpecifier;
        } else if (ts.isExportDeclaration(statement)) {
          moduleSpecifier = statement.moduleSpecifier;
        } else if (ts.isImportEqualsDeclaration(statement)) {
          if (ts.isExternalModuleReference(statement.moduleReference)) {
            moduleSpecifier = statement.moduleReference.expression;
          }
        }

        if (!moduleSpecifier || !ts.isStringLiteral(moduleSpecifier)) continue;

        const importPath = moduleSpecifier.text;
        const resolvedPath = this.resolveImport(currentPath, importPath);
        if (!resolvedPath || files.has(resolvedPath)) continue;

        if (!fs.existsSync(resolvedPath)) continue;
        const content = fs.readFileSync(resolvedPath, "utf-8");
        const sourceFile = ts.createSourceFile(resolvedPath, content, ts.ScriptTarget.Latest, true);
        if (!this.shouldInlineFile(sourceFile)) continue;
        files.set(resolvedPath, createCollectedFile(sourceFile, false));
        queue.push(resolvedPath);
      }
    }

    return files;
  }
}
