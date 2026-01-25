import type ts from "typescript";
import { DeclarationCollector } from "./declaration-collector.js";
import { ExportResolver } from "./export-resolver.js";
import type { FileCollector } from "./file-collector.js";
import { ImportParser } from "./import-parser.js";
import type { TypeRegistry } from "./registry.js";
import type { ImportInfo } from "./types.js";

export class DeclarationParser {
  public importMap: Map<string, Map<string, ImportInfo>>;
  public entryExportEquals: ts.ExportAssignment | null = null;
  public entryExportDefaultName: string | null = null;
  public entryExportDefault: ts.ExportAssignment | null = null;
  private registry: TypeRegistry;
  private fileCollector: FileCollector;
  private options: { inlineDeclareGlobals: boolean; inlineDeclareExternals: boolean };
  private importParser: ImportParser;
  private declarationCollector: DeclarationCollector;
  private exportResolver: ExportResolver;

  constructor(
    registry: TypeRegistry,
    fileCollector: FileCollector,
    options?: { inlineDeclareGlobals?: boolean; inlineDeclareExternals?: boolean },
  ) {
    this.registry = registry;
    this.fileCollector = fileCollector;
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
