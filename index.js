#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import pkg from "./package.json" with { type: "json" };

const version = pkg.version;

// Parse command-line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    entry: null,
    output: null,
    inlinedLibraries: [],
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-e" || arg === "--entry") {
      options.entry = args[++i];
    } else if (arg === "-o" || arg === "--output") {
      options.output = args[++i];
    } else if (arg === "-i" || arg === "--inlinedLibraries") {
      const libs = args[++i];
      options.inlinedLibraries = libs
        ? libs
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
    } else if (arg === "-h" || arg === "--help") {
      console.log("TypeScript Type Bundler");
      console.log("\nUsage: bundle-types -e <entry> -o <output> [-i <inlinedLibraries>]");
      console.log("\nOptions:");
      console.log("  -e, --entry <file>              Entry TypeScript file");
      console.log("  -o, --output <file>             Output bundled file");
      console.log("  -i, --inlinedLibraries <list>   Comma-separated libraries to inline");
      console.log("  -h, --help                      Show this help message");
      console.log("\nExample:");
      console.log("  node scripts/bundle-types.js -e ./src/types.ts -o ./dist/bundle.ts");
      console.log("  node scripts/bundle-types.js -e ./src/types.ts -o ./dist/bundle.ts -i @my-org/types");
      process.exit(0);
    }
  }

  if (!options.entry || !options.output) {
    console.error("Error: Missing required arguments");
    console.error("\nUsage: bundle-types -e <entry> -o <output> [-i <inlinedLibraries>]");
    console.error("  -e, --entry <file>              Entry TypeScript file");
    console.error("  -o, --output <file>             Output bundled file");
    console.error("  -i, --inlinedLibraries <list>   Comma-separated libraries to inline");
    console.error("\nUse -h or --help for more information");
    process.exit(1);
  }

  return options;
}

// Create initial state
function createState(entry, inlinedLibraries = []) {
  return {
    entryFile: path.resolve(entry),
    inlinedLibraries,
    processedFiles: new Set(),
    externalImports: new Map(),
    bundledContent: [],
    // Tree shaking data
    allDeclarations: new Map(), // Map<declarationName, { text, sourceFile, dependencies: Set<string>, isExported }>
    usedTypes: new Set(), // Set of type names that are actually used
    // Import alias tracking
    aliasMap: new Map(), // Map<filePathHash, Map<localName, originalName>> - tracks import aliases per file
    fileAliases: new Map(), // Map for current file being processed
  };
}

// Check if an import should be inlined
function shouldInline(importPath, inlinedLibraries) {
  if (importPath.startsWith(".")) {
    return true;
  }
  return inlinedLibraries.some((lib) => importPath === lib || importPath.startsWith(`${lib}/`));
}

// Resolve import path to absolute file path
function resolveImport(fromFile, importPath) {
  if (importPath.startsWith(".")) {
    const dir = path.dirname(fromFile);
    const resolved = path.resolve(dir, importPath);

    const extensions = [".ts", ".tsx", ".d.ts", "/index.ts", "/index.tsx"];
    for (const ext of extensions) {
      const fullPath = resolved + ext;
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }

    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }

  return null;
}

// Extract type imports from external modules
function extractTypeImports(node) {
  if (!ts.isImportDeclaration(node)) {
    return null;
  }

  const moduleSpecifier = node.moduleSpecifier;
  if (!ts.isStringLiteral(moduleSpecifier)) {
    return null;
  }

  const moduleName = moduleSpecifier.text;
  const importClause = node.importClause;

  if (!importClause) {
    return null;
  }

  const imports = new Set();

  if (importClause.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
    importClause.namedBindings.elements.forEach((element) => {
      const name = element.name.text;
      const propertyName = element.propertyName?.text;
      if (propertyName) {
        imports.add(`${propertyName} as ${name}`);
      } else {
        imports.add(name);
      }
    });
  }

  if (importClause.namedBindings && ts.isNamespaceImport(importClause.namedBindings)) {
    imports.add(`* as ${importClause.namedBindings.name.text}`);
  }

  if (importClause.name) {
    imports.add(`default as ${importClause.name.text}`);
  }

  return { moduleName, imports, isTypeOnly: node.importClause?.isTypeOnly || false };
}

// Get the name of a declaration (interface, type, etc.)
function getDeclarationName(statement) {
  if (
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isClassDeclaration(statement)
  ) {
    return statement.name?.text;
  }
  if (ts.isEnumDeclaration(statement)) {
    return statement.name?.text;
  }
  if (ts.isModuleDeclaration(statement)) {
    return statement.name?.text;
  }
  return null;
}

// Extract all type references from a node
function extractTypeReferences(node, references = new Set(), aliasMap = new Map()) {
  // Handle type reference nodes directly
  if (ts.isTypeReferenceNode(node)) {
    const typeName = node.typeName;
    if (ts.isIdentifier(typeName)) {
      const name = typeName.text;
      // Resolve alias to original name
      const originalName = aliasMap.get(name) || name;
      references.add(originalName);
    } else if (ts.isQualifiedName(typeName)) {
      // Handle qualified names like Namespace.Type
      let current = typeName;
      while (ts.isQualifiedName(current)) {
        if (ts.isIdentifier(current.right)) {
          const name = current.right.text;
          const originalName = aliasMap.get(name) || name;
          references.add(originalName);
        }
        current = current.left;
      }
      if (ts.isIdentifier(current)) {
        const name = current.text;
        const originalName = aliasMap.get(name) || name;
        references.add(originalName);
      }
    }
  }

  // Recursively visit all child nodes using a more thorough visitor
  function visit(node) {
    extractTypeReferences(node, references, aliasMap);
  }

  node.forEachChild(visit);

  return references;
}

// Replace import aliases with original names in declaration text
function replaceAliasesInText(text, aliasMap) {
  if (!aliasMap || aliasMap.size === 0) {
    return text;
  }

  let result = text;
  // Sort by length (longest first) to avoid partial replacements
  const aliases = Array.from(aliasMap.entries()).sort((a, b) => b[0].length - a[0].length);

  for (const [alias, original] of aliases) {
    // Use regex with word boundaries to avoid partial replacements
    // Match the alias only when it's a complete identifier
    const regex = new RegExp(`\\b${alias}\\b`, "g");
    result = result.replace(regex, original);
  }

  return result;
}

// Mark a type and all its dependencies as used
function markTypeAsUsed(typeName, state) {
  if (state.usedTypes.has(typeName)) {
    return; // Already processed
  }

  state.usedTypes.add(typeName);

  // Find the declaration and mark its dependencies as used too
  const declaration = state.allDeclarations.get(typeName);
  if (declaration && declaration.dependencies) {
    declaration.dependencies.forEach((depName) => {
      markTypeAsUsed(depName, state);
    });
  }
}

// Process a TypeScript file
function processFile(filePath, state, isEntryFile = false) {
  if (state.processedFiles.has(filePath)) {
    return state;
  }

  state.processedFiles.add(filePath);

  const content = fs.readFileSync(filePath, "utf-8");
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);

  // Set up alias map for this file and save previous one
  const previousFileAliases = state.fileAliases;
  if (!state.aliasMap.has(filePath)) {
    state.aliasMap.set(filePath, new Map());
  }
  state.fileAliases = state.aliasMap.get(filePath);

  sourceFile.statements.forEach((statement) => {
    if (ts.isImportDeclaration(statement)) {
      const moduleSpecifier = statement.moduleSpecifier;
      if (ts.isStringLiteral(moduleSpecifier)) {
        const importPath = moduleSpecifier.text;

        if (shouldInline(importPath, state.inlinedLibraries)) {
          // Extract import aliases for inlined imports
          const importClause = statement.importClause;
          if (importClause?.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
            importClause.namedBindings.elements.forEach((element) => {
              const localName = element.name.text;
              const originalName = element.propertyName?.text || localName;
              if (localName !== originalName) {
                state.fileAliases.set(localName, originalName);
              }
            });
          }

          const resolvedPath = resolveImport(filePath, importPath);
          if (resolvedPath) {
            processFile(resolvedPath, state, false);
          } else {
            console.warn(`Warning: Could not resolve import "${importPath}" from ${filePath}`);
          }
        } else {
          const importInfo = extractTypeImports(statement);
          if (importInfo) {
            if (!state.externalImports.has(importInfo.moduleName)) {
              state.externalImports.set(importInfo.moduleName, {
                imports: new Set(),
                isTypeOnly: importInfo.isTypeOnly,
              });
            }
            const existing = state.externalImports.get(importInfo.moduleName);
            importInfo.imports.forEach((imp) => existing.imports.add(imp));
          }
        }
      }
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
      const moduleSpecifier = statement.moduleSpecifier;
      if (ts.isStringLiteral(moduleSpecifier)) {
        const exportPath = moduleSpecifier.text;

        if (shouldInline(exportPath, state.inlinedLibraries)) {
          const resolvedPath = resolveImport(filePath, exportPath);
          if (resolvedPath) {
            processFile(resolvedPath, state, false);
          }
        }
      }
    } else if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier) {
      // Skip empty export statements: export {} or export { };
      // These are used to mark a file as a module and should not be included
      if (
        !statement.exportClause ||
        (ts.isNamedExports(statement.exportClause) && statement.exportClause.elements.length === 0)
      ) {
        // Skip empty exports
      } else {
        // This is an export with actual content, track it for tree shaking
        const text = statement.getFullText(sourceFile).trim();
        if (text && isEntryFile) {
          // Track what's exported but don't mark as used yet (will be done in second pass)
          state.bundledContent.push(text);
        }
      }
    } else {
      // Get the full text including JSDoc comments (leading trivia)
      let text = statement.getFullText(sourceFile).trim();
      if (text) {
        const declarationName = getDeclarationName(statement);
        const isExported = text.includes("export ");

        // For non-entry files, strip the export keyword to make declarations internal
        // but preserve JSDoc comments which come before the export keyword
        if (!isEntryFile && isExported) {
          // Use a regex that handles JSDoc comments before export
          text = text.replace(/^((?:\/\*\*[\s\S]*?\*\/\s*)?)export\s+/, "$1");
        }

        if (declarationName) {
          // Extract type dependencies (with alias resolution)
          const dependencies = extractTypeReferences(statement, new Set(), state.fileAliases);

          // Replace aliases in the text with original names
          const textWithResolvedAliases = replaceAliasesInText(text, state.fileAliases);

          state.allDeclarations.set(declarationName, {
            text: textWithResolvedAliases,
            sourceFile: filePath,
            dependencies,
            isExported: isEntryFile && isExported,
            aliases: new Map(state.fileAliases), // Store aliases for this declaration
          });
        } else {
          // For statements without a name (like export statements), add directly
          state.bundledContent.push(text);
        }
      }
    }
  });

  // Restore previous file aliases
  state.fileAliases = previousFileAliases;

  return state;
}

// Generate the final bundled output
function generateOutput(state) {
  const lines = [];

  // write a header comment that includes the library name and version
  lines.push(`// Generated by @qlik/dts-bundler@${version}\n`);

  if (state.externalImports.size > 0) {
    const sortedModules = Array.from(state.externalImports.keys()).sort();

    for (const moduleName of sortedModules) {
      const { imports, isTypeOnly } = state.externalImports.get(moduleName);
      const importList = Array.from(imports).sort();

      const typePrefix = isTypeOnly ? "type " : "";

      if (importList.some((imp) => imp.startsWith("* as "))) {
        lines.push(`import ${typePrefix}${importList.join(", ")} from "${moduleName}";`);
      } else {
        const formattedImports = importList
          .map((imp) => {
            if (imp.startsWith("default as ")) {
              return imp.replace("default as ", "");
            }
            return imp;
          })
          .filter((imp) => !imp.startsWith("default as "));

        if (formattedImports.length > 0) {
          lines.push(`import ${typePrefix}{ ${formattedImports.join(", ")} } from "${moduleName}";`);
        }
      }
    }

    lines.push("");
  }

  // Add only used declarations (tree shaking)
  const usedDeclarations = [];
  for (const [name, declaration] of state.allDeclarations.entries()) {
    if (state.usedTypes.has(name)) {
      usedDeclarations.push(declaration.text);
    }
  }

  // Add other bundled content (non-declarations)
  lines.push(...usedDeclarations);
  lines.push(...state.bundledContent);

  // Only add empty export if there are no exports in the bundled content
  const hasExports = [...usedDeclarations, ...state.bundledContent].some((line) => line.trim().startsWith("export "));
  if (!hasExports) {
    lines.push("\nexport {};");
  }

  return lines.join("\n");
}

// Main bundling function
function bundle(entry, inlinedLibraries = []) {
  const state = createState(entry, inlinedLibraries);

  if (!fs.existsSync(state.entryFile)) {
    throw new Error(`Entry file ${state.entryFile} does not exist`);
  }

  // First pass: collect all declarations
  processFile(state.entryFile, state, true);

  // Second pass: mark used types starting from entry exports
  for (const [name, declaration] of state.allDeclarations.entries()) {
    if (declaration.isExported) {
      markTypeAsUsed(name, state);
    }
  }

  const outputContent = generateOutput(state);

  return outputContent;
}

/**
 * Bundle TypeScript declaration files
 * @param {Object} options - Bundling options
 * @param {string} options.entry - Entry TypeScript file path
 * @param {string[]} [options.inlinedLibraries=[]] - Array of library names to inline
 * @returns {string} The bundled TypeScript declaration content
 */
export function bundleDts(options) {
  const { entry, inlinedLibraries = [] } = options;

  if (!entry) {
    throw new Error("The 'entry' option is required");
  }

  return bundle(entry, inlinedLibraries);
}

// Main execution for CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseArgs();

  console.log(`Bundling types from ${path.resolve(options.entry)}...`);

  try {
    const bundledContent = bundleDts({
      entry: options.entry,
      inlinedLibraries: options.inlinedLibraries,
    });

    const outputPath = path.resolve(options.output);
    const outputDir = path.dirname(outputPath);

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, bundledContent, "utf-8");
    console.log(`✓ Types bundled successfully to ${outputPath}`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}
