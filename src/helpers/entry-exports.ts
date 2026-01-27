import ts from "typescript";
import type { TypeRegistry } from "../registry.js";
import { ExportKind } from "../types.js";
import { findSyntheticDefaultName, resolveDefaultExportNameFromRegistry } from "./default-export.js";

export type EntryExportData = {
  exportFromByModule: Map<string, string[]>;
  exportListItems: string[];
  excludedExternalImports: Set<string>;
  requiredExternalImports: Set<string>;
};

const collectDeclarationExternalImports = (registry: TypeRegistry, usedDeclarations: Set<symbol>): Set<string> => {
  const externalImports = new Set<string>();
  for (const declId of usedDeclarations) {
    const declaration = registry.getDeclaration(declId);
    if (!declaration) continue;
    for (const [moduleName, importNames] of declaration.externalDependencies.entries()) {
      for (const importName of importNames) {
        externalImports.add(`${moduleName}:${importName}`);
      }
    }
  }

  return externalImports;
};

const resolveEntryExportOriginalName = (
  registry: TypeRegistry,
  entryFile: string,
  exported: { name: string; originalName?: string; sourceFile?: string },
): { sourceFile: string; originalName: string } => {
  const sourceFile = exported.sourceFile ?? entryFile;
  let originalName = exported.originalName ?? exported.name;

  if (originalName === "default" && exported.sourceFile) {
    const resolvedDefault = resolveDefaultExportNameFromRegistry(registry, exported.sourceFile);
    if (resolvedDefault) {
      originalName = resolvedDefault;
    } else {
      const syntheticDefault = findSyntheticDefaultName(registry, exported.sourceFile);
      if (syntheticDefault) {
        originalName = syntheticDefault;
      }
    }
  }

  if (exported.sourceFile && originalName === "default") {
    const syntheticDefault = findSyntheticDefaultName(registry, exported.sourceFile);
    if (syntheticDefault) {
      originalName = syntheticDefault;
    }
  }

  return { sourceFile, originalName };
};

const shouldSkipEntryExport = (
  registry: TypeRegistry,
  entryFile: string,
  exported: { name: string; originalName?: string; sourceFile?: string },
): boolean => {
  const { sourceFile, originalName } = resolveEntryExportOriginalName(registry, entryFile, exported);

  if (originalName !== exported.name) {
    return false;
  }

  const declId = registry.nameIndex.get(`${sourceFile}:${originalName}`);
  if (!declId) {
    return false;
  }

  const decl = registry.getDeclaration(declId);
  if (!decl) {
    return false;
  }

  return decl.exportInfo.kind === ExportKind.Named || decl.exportInfo.wasOriginallyExported;
};

export const buildEntryExportData = (params: {
  registry: TypeRegistry;
  usedDeclarations: Set<symbol>;
  entryFile?: string;
  nameMap: Map<string, string>;
  getNormalizedExternalImportName: (moduleName: string, importName: string) => string;
  extractImportName: (importStr: string) => string;
}): EntryExportData => {
  const exportFromByModule = new Map<string, string[]>();
  const exportListItems: string[] = [];
  const exportListSet = new Set<string>();
  const excludedExternalImports = new Set<string>();
  const requiredExternalImports = new Set<string>();

  const entryFile = params.entryFile;
  if (!entryFile) {
    return { exportFromByModule, exportListItems, excludedExternalImports, requiredExternalImports };
  }

  const declarationExternalImports = collectDeclarationExternalImports(params.registry, params.usedDeclarations);
  const exportedNames = params.registry.exportedNamesByFile.get(entryFile) ?? [];
  const namespaceExports = new Set(
    params.registry.entryNamespaceExports.filter((entry) => entry.sourceFile === entryFile).map((entry) => entry.name),
  );
  const moduleAugmentations = new Set<string>();
  const entryDeclarations = params.registry.declarationsByFile.get(entryFile);
  if (entryDeclarations) {
    for (const declId of entryDeclarations) {
      const decl = params.registry.getDeclaration(declId);
      if (decl && ts.isModuleDeclaration(decl.node) && ts.isIdentifier(decl.node.name)) {
        moduleAugmentations.add(decl.node.name.text);
      }
    }
  }

  for (const exported of exportedNames) {
    if (exported.name === "default") {
      continue;
    }

    if (namespaceExports.has(exported.name)) {
      continue;
    }

    if (moduleAugmentations.has(exported.name)) {
      continue;
    }

    if (exported.externalModule && exported.externalImportName) {
      const importName = params.getNormalizedExternalImportName(exported.externalModule, exported.externalImportName);
      const importKey = `${exported.externalModule}:${exported.externalImportName}`;

      if (exported.exportFrom && !declarationExternalImports.has(importKey)) {
        const list = exportFromByModule.get(exported.externalModule) ?? [];
        list.push(importName);
        exportFromByModule.set(exported.externalModule, list);
        excludedExternalImports.add(importKey);
        continue;
      }

      requiredExternalImports.add(importKey);
      const exportName = params.extractImportName(importName);
      if (!exportListSet.has(exportName)) {
        exportListSet.add(exportName);
        exportListItems.push(exportName);
      }
      continue;
    }

    const { sourceFile, originalName } = resolveEntryExportOriginalName(params.registry, entryFile, exported);
    const normalizedOriginal = params.nameMap.get(`${sourceFile}:${originalName}`) ?? originalName;
    const exportItem =
      normalizedOriginal === exported.name ? normalizedOriginal : `${normalizedOriginal} as ${exported.name}`;

    if (shouldSkipEntryExport(params.registry, entryFile, exported)) {
      continue;
    }

    if (!exportListSet.has(exportItem)) {
      exportListSet.add(exportItem);
      exportListItems.push(exportItem);
    }
  }

  const getExportedName = (item: string): string => {
    if (item.includes(" as ")) {
      return item.split(" as ")[1]?.trim() ?? item.trim();
    }
    return item.trim();
  };

  exportListItems.sort((a, b) => getExportedName(a).localeCompare(getExportedName(b)));

  return { exportFromByModule, exportListItems, excludedExternalImports, requiredExternalImports };
};
