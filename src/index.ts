#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { DeclarationParser } from "./declaration-parser.js";
import { DependencyAnalyzer } from "./dependency-analyzer.js";
import { FileCollector } from "./file-collector.js";
import { NameNormalizer } from "./name-normalizer.js";
import { OutputGenerator } from "./output-generator.js";
import { TypeRegistry } from "./registry.js";
import { TreeShaker } from "./tree-shaker.js";
import type { BundleDtsOptions } from "./types.js";

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
  const includeEmptyExport = files.get(entryFile)?.hasEmptyExport ?? false;

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

  const analyzer = new DependencyAnalyzer(registry, parser.importMap);
  analyzer.analyze();

  const normalizer = new NameNormalizer(registry);
  normalizer.normalize();

  const shaker = new TreeShaker(registry, {
    exportReferencedTypes: options.exportReferencedTypes,
    entryFile,
  });
  const { declarations: usedDeclarations, externalImports: usedExternals } = shaker.shake();

  const generator = new OutputGenerator(registry, usedDeclarations, usedExternals, {
    ...options,
    includeEmptyExport,
    referencedTypes: allReferencedTypes,
    entryExportEquals: parser.entryExportEquals,
    entryExportDefault: parser.entryExportDefault,
    entryExportDefaultName: parser.entryExportDefaultName,
    entryFile,
    typeChecker: collector.getTypeChecker(),
    preserveConstEnums: collector.getCompilerOptions().preserveConstEnums ?? false,
  });
  return generator.generate();
}

/**
 * Bundle TypeScript declaration files
 * @param options - Bundling options
 * @returns The bundled TypeScript declaration content
 */
export function bundleDts(options: BundleDtsOptions): string {
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseArgs();

  console.log(`Bundling types from ${path.resolve(options.entry as string)}...`);

  try {
    const bundledContent = bundleDts({
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
