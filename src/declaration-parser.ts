import type ts from "typescript";
import { DeclarationCollector } from "./declaration-collector";
import { ExportResolver } from "./export-resolver";
import type { FileCollector } from "./file-collector";
import { ImportParser } from "./import-parser";
import type { TypeRegistry } from "./registry";
import type { ImportInfo } from "./types";

/**
 * Parses declarations, imports and exports from a group of `SourceFile`s
 * and collects information required to build the final declaration bundle.
 *
 * Responsibilities:
 * - collect imports for each file (`importMap`)
 * - collect declarations via `DeclarationCollector`
 * - resolve exports via `ExportResolver`
 */
export class DeclarationParser {
  /** Map from file path -> (import name -> ImportInfo) for that file. */
  public importMap: Map<string, Map<string, ImportInfo>>;

  /** If the entry file contains an `export =` assignment, this holds that node. */
  public entryExportEquals: ts.ExportAssignment | null = null;

  /** Name of the entry file's default export (when available). */
  public entryExportDefaultName: string | null = null;

  /** If the entry file contains an `export default` assignment node, this holds that node. */
  public entryExportDefault: ts.ExportAssignment | null = null;

  private options: { inlineDeclareGlobals: boolean; inlineDeclareExternals: boolean };
  private importParser: ImportParser;
  private declarationCollector: DeclarationCollector;
  private exportResolver: ExportResolver;

  /**
   * Create a `DeclarationParser`.
   * @param registry - Shared `TypeRegistry` used for symbol information.
   * @param fileCollector - Helper for resolving/collecting file relationships.
   * @param options - Optional flags to control inlining of `declare global` and external `declare module` blocks.
   */
  constructor(
    registry: TypeRegistry,
    fileCollector: FileCollector,
    options?: { inlineDeclareGlobals?: boolean; inlineDeclareExternals?: boolean },
  ) {
    this.importMap = new Map();
    this.options = {
      inlineDeclareGlobals: options?.inlineDeclareGlobals ?? false,
      inlineDeclareExternals: options?.inlineDeclareExternals ?? false,
    };
    this.importParser = new ImportParser(registry, fileCollector, {
      inlineDeclareExternals: this.options.inlineDeclareExternals,
    });
    this.declarationCollector = new DeclarationCollector(registry, fileCollector, this.options);
    this.exportResolver = new ExportResolver(registry, fileCollector);
  }

  /**
   * Parse a set of files and populate internal maps/records.
   * The method performs several passes over the supplied `files` map:
   * 1. collect imports for each file
   * 2. collect direct namespace exports
   * 3. collect file-level exports (using the import map)
   * 4. collect declarations and handle export assignments (tracking entry-file exports)
   * 5. resolve `export =` assignments and parse re-exports for the entry file
   * 6. apply star-exports to finalize export relationships
   *
   * @param files - Map of file path -> { sourceFile, isEntry }
   */
  parseFiles(files: Map<string, { sourceFile: ts.SourceFile; isEntry: boolean }>): void {
    for (const [filePath, { sourceFile }] of files.entries()) {
      const fileImports = this.importParser.parseImports(filePath, sourceFile);
      this.importMap.set(filePath, fileImports);
    }

    for (const [filePath, { sourceFile }] of files.entries()) {
      this.exportResolver.collectDirectNamespaceExports(filePath, sourceFile);
    }

    for (const [filePath, { sourceFile, isEntry }] of files.entries()) {
      this.exportResolver.collectFileExports(filePath, sourceFile, this.importMap, isEntry);
    }

    for (const [filePath, { sourceFile, isEntry }] of files.entries()) {
      this.declarationCollector.collectDeclarations(filePath, sourceFile, isEntry, (name: string) => {
        this.entryExportDefaultName = name;
      });

      this.exportResolver.handleExportAssignments(
        filePath,
        sourceFile,
        isEntry,
        this.importMap,
        (statement: ts.ExportAssignment) => {
          this.entryExportEquals = statement;
        },
        (statement: ts.ExportAssignment) => {
          this.entryExportDefault = statement;
        },
      );
    }

    for (const [filePath, { sourceFile, isEntry }] of files.entries()) {
      if (isEntry) {
        this.exportResolver.parseReExports(filePath, sourceFile, this.importMap, (name: string) => {
          if (!this.entryExportDefaultName) {
            this.entryExportDefaultName = name;
          }
        });
      }
      ExportResolver.resolveExportEquals(filePath, sourceFile, this.importMap);
    }

    this.exportResolver.applyStarExports();
  }
}
