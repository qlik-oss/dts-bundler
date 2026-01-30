import ts from "typescript";
import { hasDefaultModifier } from "../declaration-utils.js";
import type { TypeRegistry } from "../registry.js";
import { ExportKind } from "../types.js";

export const resolveDefaultExportNameFromRegistry = (registry: TypeRegistry, filePath: string): string | null => {
  const declarations = registry.declarationsByFile.get(filePath);
  if (!declarations) {
    return null;
  }

  for (const declId of declarations) {
    const decl = registry.getDeclaration(declId);
    if (!decl) continue;
    if (
      decl.exportInfo.kind === ExportKind.Default ||
      decl.exportInfo.kind === ExportKind.DefaultOnly ||
      decl.exportInfo.kind === ExportKind.NamedAndDefault
    ) {
      return decl.name;
    }
    if (ts.isStatement(decl.node) && hasDefaultModifier(decl.node)) {
      return decl.name;
    }
  }

  return null;
};

export const findSyntheticDefaultName = (registry: TypeRegistry, filePath: string): string | null => {
  const declarations = registry.declarationsByFile.get(filePath);
  if (!declarations) {
    return null;
  }

  for (const declId of declarations) {
    const decl = registry.getDeclaration(declId);
    if (decl && decl.name.startsWith("_default")) {
      return decl.name;
    }
  }

  return null;
};
