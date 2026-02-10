#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { DeclarationParser } from "./declaration-parser";
import { DependencyAnalyzer } from "./dependency-analyzer";
import { FileCollector } from "./file-collector";
import { NameNormalizer } from "./name-normalizer";
import { OutputGenerator } from "./output-generator";
import { TypeRegistry } from "./registry";
import { TreeShaker } from "./tree-shaker";
import type { BundleTypesOptions } from "./types";

function bundle(
  entry: string,
  inlinedLibraries: string[] = [],
  options: {
    noBanner?: boolean;
    sortNodes?: boolean;
    umdModuleName?: string;
    exportReferencedTypes?: boolean;
    includeEmptyExport?: boolean;
    allowedTypesLibraries?: string[];
    importedLibraries?: string[];
    referencedTypes?: Set<string>;
    inlineDeclareGlobals?: boolean;
    inlineDeclareExternals?: boolean;
    respectPreserveConstEnum?: boolean;
  } = {},
): string {
  const entryFile = path.resolve(entry);

  if (!fs.existsSync(entryFile)) {
    throw new Error(`Entry file ${entryFile} does not exist`);
  }

  const collector = new FileCollector(entryFile, { inlinedLibraries });
  const files = collector.collectFiles();
  const includeEmptyExportFromSource = files.get(entryFile)?.hasEmptyExport ?? false;

  // Collect all referenced types from all files
  const allReferencedTypes = new Set<string>();
  for (const file of files.values()) {
    for (const refType of file.referencedTypes) {
      allReferencedTypes.add(refType);
    }
  }

  const registry = new TypeRegistry();
  const parser = new DeclarationParser(registry, collector, {
    inlineDeclareGlobals: options.inlineDeclareGlobals ?? false,
    inlineDeclareExternals: options.inlineDeclareExternals ?? false,
  });
  parser.parseFiles(files);

  const analyzer = new DependencyAnalyzer(registry, parser.importMap, collector, entryFile);
  analyzer.analyze();

  const normalizer = new NameNormalizer(registry, entryFile, collector.getTypeChecker());
  normalizer.normalize();

  const entryImports = parser.importMap.get(entryFile);
  const entrySourceFile = files.get(entryFile)?.sourceFile;

  const entryImportedFiles = new Set<string>();
  const entryReferencedFiles = new Set<string>();
  if (entryImports) {
    for (const importInfo of entryImports.values()) {
      if (!importInfo.isExternal && importInfo.sourceFile) {
        entryImportedFiles.add(importInfo.sourceFile);
      }
    }
  }
  if (entrySourceFile) {
    const entryDir = path.dirname(entryFile);
    for (const statement of entrySourceFile.statements) {
      if (!ts.isImportDeclaration(statement)) continue;
      if (statement.importClause) continue;
      if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const resolvedPath = collector.resolveImport(entryFile, statement.moduleSpecifier.text);
      if (resolvedPath) {
        entryImportedFiles.add(resolvedPath);
      }
    }
    for (const reference of entrySourceFile.referencedFiles) {
      entryReferencedFiles.add(path.resolve(entryDir, reference.fileName));
    }
  }
  const entryRootFiles = new Set(entryImportedFiles);
  for (const referencedFile of entryReferencedFiles) {
    entryRootFiles.add(referencedFile);
  }
  if (entryFile) {
    const exportedNames = registry.exportedNamesByFile.get(entryFile) ?? [];
    for (const info of exportedNames) {
      if (info.sourceFile) {
        entryRootFiles.add(info.sourceFile);
      }
    }
    for (const entryExport of registry.entryNamespaceExports) {
      if (entryExport.sourceFile !== entryFile) continue;
      const info = registry.getNamespaceExportInfo(entryExport.sourceFile, entryExport.name);
      if (info?.targetFile) {
        entryRootFiles.add(info.targetFile);
      }
    }
    for (const entryExport of registry.entryStarExports) {
      if (entryExport.sourceFile !== entryFile) continue;
      if (entryExport.info.targetFile) {
        entryRootFiles.add(entryExport.info.targetFile);
      }
    }
  }

  const shaker = new TreeShaker(registry, {
    entryFile,
    entryImports: entryImports ?? undefined,
    entrySourceFile: entrySourceFile ?? undefined,
    entryImportedFiles: entryRootFiles,
    entryReferencedFiles,
  });
  const {
    declarations: usedDeclarations,
    externalImports: usedExternals,
    detectedTypesLibraries,
    declarationOrder,
  } = shaker.shake();

  // Strip unnecessary $N suffixes when collisions were removed by tree-shaking.
  NameNormalizer.stripUnnecessarySuffixes(registry, usedDeclarations, usedExternals);

  const hasGlobalAugmentation = Array.from(usedDeclarations).some((id) => {
    const declaration = registry.getDeclaration(id);
    return Boolean(
      declaration &&
      ts.isModuleDeclaration(declaration.node) &&
      // eslint-disable-next-line no-bitwise
      declaration.node.flags & ts.NodeFlags.GlobalAugmentation,
    );
  });

  const includeEmptyExport = includeEmptyExportFromSource || hasGlobalAugmentation;

  const generator = new OutputGenerator(registry, usedDeclarations, usedExternals, {
    ...options,
    includeEmptyExport,
    referencedTypes: allReferencedTypes,
    entryExportEquals: parser.entryExportEquals,
    entryExportDefault: parser.entryExportDefault,
    entryExportDefaultName: parser.entryExportDefaultName,
    entryFile,
    entryImportedFiles,
    declarationOrder,
    detectedTypesLibraries,
    typeChecker: collector.getTypeChecker(),
    preserveConstEnums: collector.getCompilerOptions().preserveConstEnums ?? false,
    importTypeResolver: {
      shouldInline: collector.shouldInline.bind(collector),
      resolveImport: collector.resolveImport.bind(collector),
    },
  });
  return generator.generate();
}

/**
 * Bundle TypeScript declaration files
 * @param options - Bundling options
 * @returns The bundled TypeScript declaration content
 */
export function bundleTypes(options: BundleTypesOptions): string {
  const {
    entry,
    inlinedLibraries = [],
    allowedTypesLibraries,
    importedLibraries,
    noBanner,
    sortNodes,
    umdModuleName,
    exportReferencedTypes,
    inlineDeclareGlobals,
    inlineDeclareExternals,
    respectPreserveConstEnum,
  } = options;

  if (!entry) {
    throw new Error("The 'entry' option is required");
  }

  return bundle(entry, inlinedLibraries, {
    noBanner,
    sortNodes,
    umdModuleName,
    exportReferencedTypes,
    allowedTypesLibraries,
    importedLibraries,
    inlineDeclareGlobals,
    inlineDeclareExternals,
    respectPreserveConstEnum,
  });
}

function parseArgs(): { entry: string | null; output: string | null; inlinedLibraries: string[] } {
  const args = process.argv.slice(2);
  const options = {
    entry: null as string | null,
    output: null as string | null,
    inlinedLibraries: [] as string[],
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-e" || arg === "--entry") {
      options.entry = args[++i] ?? null;
    } else if (arg === "-o" || arg === "--output") {
      options.output = args[++i] ?? null;
    } else if (arg === "-i" || arg === "--inlinedLibraries") {
      const libs = args[++i];
      options.inlinedLibraries = libs
        ? libs
            .split(",")
            .map((s: string) => s.trim())
            .filter(Boolean)
        : [];
    } else if (arg === "-h" || arg === "--help") {
      console.log("TypeScript Type Bundler v2");
      console.log("\nUsage: bundle-types -e <entry> -o <output> [-i <inlinedLibraries>]");
      console.log("\nOptions:");
      console.log("  -e, --entry <file>              Entry TypeScript file");
      console.log("  -o, --output <file>             Output bundled file");
      console.log("  -i, --inlinedLibraries <list>   Comma-separated libraries to inline");
      console.log("  -h, --help                      Show this help message");
      process.exit(0);
    }
  }

  if (!options.entry || !options.output) {
    console.error("Error: Missing required arguments");
    console.error("\nUsage: bundle-types -e <entry> -o <output> [-i <inlinedLibraries>]");
    process.exit(1);
  }

  return options;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
const __filename = fileURLToPath(import.meta.url);

function isRunAsCli(): boolean {
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(__filename);
  } catch {
    return false;
  }
}

if (isRunAsCli()) {
  const options = parseArgs();

  console.log(`Bundling types from ${path.resolve(options.entry as string)}...`);

  try {
    const bundledContent = bundleTypes({
      entry: options.entry as string,
      inlinedLibraries: options.inlinedLibraries,
    });

    const outputPath = path.resolve(options.output as string);
    const outputDir = path.dirname(outputPath);

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, bundledContent, "utf-8");
    console.log(`✓ Types bundled successfully to ${outputPath}`);
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
    process.exit(1);
  }
}
