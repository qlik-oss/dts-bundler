import ts from "typescript";

/**
 * Return true when the statement is a top-level declaration that should be
 * considered by the bundler (interfaces, types, classes, enums, modules,
 * functions and variable statements).
 */
export function isDeclaration(statement: ts.Statement): boolean {
  return (
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isClassDeclaration(statement) ||
    ts.isEnumDeclaration(statement) ||
    ts.isModuleDeclaration(statement) ||
    ts.isFunctionDeclaration(statement) ||
    ts.isVariableStatement(statement)
  );
}

/**
 * Return a stable name for a top-level declaration when possible.
 * For named declarations this returns the declared identifier text. For
 * variable binding patterns a synthetic name is returned using the node
 * position to make it deterministic. Returns `null` when a name cannot be derived.
 */
export function getDeclarationName(statement: ts.Statement): string | null {
  if (
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isClassDeclaration(statement) ||
    ts.isEnumDeclaration(statement) ||
    ts.isModuleDeclaration(statement) ||
    ts.isFunctionDeclaration(statement)
  ) {
    return statement.name?.text ?? null;
  }

  if (ts.isVariableStatement(statement)) {
    const declaration = statement.declarationList.declarations[0];
    if (ts.isIdentifier(declaration.name)) {
      return declaration.name.text;
    }

    if (ts.isObjectBindingPattern(declaration.name) || ts.isArrayBindingPattern(declaration.name)) {
      return `__binding_${statement.pos}`;
    }
  }

  return null;
}

/**
 * True when the node has an `export` modifier.
 */
export function hasExportModifier(statement: ts.Statement): boolean {
  const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
  return modifiers?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

/**
 * True when the node has a `default` modifier.
 */
export function hasDefaultModifier(statement: ts.Statement): boolean {
  const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
  return modifiers?.some((mod) => mod.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
}

/**
 * Detect `declare global {}` module declarations (global augmentation).
 */
export function isDeclareGlobal(statement: ts.Statement): statement is ts.ModuleDeclaration {
  // eslint-disable-next-line no-bitwise
  return ts.isModuleDeclaration(statement) && (statement.flags & ts.NodeFlags.GlobalAugmentation) !== 0;
}
