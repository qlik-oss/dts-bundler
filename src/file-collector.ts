import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

interface FileCollectorOptions {
  inlinedLibraries?: string[];
}

export interface CollectedFile {
  content: string;
  sourceFile: ts.SourceFile;
  isEntry: boolean;
  hasEmptyExport: boolean;
}

export class FileCollector {
  private inlinedLibraries: string[];
  private processedFiles: Set<string>;

  constructor(options: FileCollectorOptions = {}) {
    this.inlinedLibraries = options.inlinedLibraries ?? [];
    this.processedFiles = new Set();
  }

  shouldInline(importPath: string): boolean {
    if (importPath.startsWith(".")) {
      return true;
    }
    return this.inlinedLibraries.some((lib) => importPath === lib || importPath.startsWith(`${lib}/`));
  }

  static resolveImport(fromFile: string, importPath: string): string | null {
    if (!importPath.startsWith(".")) {
      return null;
    }

    const dir = path.dirname(fromFile);
    const resolved = path.resolve(dir, importPath);

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

    if (fs.existsSync(resolved)) {
      return resolved;
    }

    return null;
  }

  collectFiles(entryFile: string): Map<string, CollectedFile> {
    const files = new Map<string, CollectedFile>();
    const toProcess: Array<{ file: string; isEntry: boolean }> = [{ file: path.resolve(entryFile), isEntry: true }];

    while (toProcess.length > 0) {
      const next = toProcess.shift();
      if (!next) break;
      const { file: filePath, isEntry } = next;

      if (this.processedFiles.has(filePath)) {
        continue;
      }

      this.processedFiles.add(filePath);

      if (!fs.existsSync(filePath)) {
        console.warn(`Warning: File not found: ${filePath}`);
        continue;
      }

      const content = fs.readFileSync(filePath, "utf-8");
      const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);

      const hasEmptyExport = sourceFile.statements.some((statement) => {
        if (!ts.isExportDeclaration(statement)) return false;
        if (statement.moduleSpecifier) return false;
        if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) return false;
        return statement.exportClause.elements.length === 0;
      });

      files.set(filePath, { content, sourceFile, isEntry, hasEmptyExport });

      for (const statement of sourceFile.statements) {
        if (ts.isImportDeclaration(statement)) {
          const moduleSpecifier = statement.moduleSpecifier;
          if (ts.isStringLiteral(moduleSpecifier)) {
            const importPath = moduleSpecifier.text;
            if (this.shouldInline(importPath)) {
              const resolved = FileCollector.resolveImport(filePath, importPath);
              if (resolved) {
                toProcess.push({ file: resolved, isEntry: false });
              }
            }
          }
        } else if (ts.isExportDeclaration(statement)) {
          const moduleSpecifier = statement.moduleSpecifier;
          if (moduleSpecifier && ts.isStringLiteral(moduleSpecifier)) {
            const exportPath = moduleSpecifier.text;
            if (this.shouldInline(exportPath)) {
              const resolved = FileCollector.resolveImport(filePath, exportPath);
              if (resolved) {
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
