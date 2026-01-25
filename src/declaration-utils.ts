import ts from "typescript";

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

export function hasExportModifier(statement: ts.Statement): boolean {
  const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
  return modifiers?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

export function hasDefaultModifier(statement: ts.Statement): boolean {
  const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
  return modifiers?.some((mod) => mod.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
}

export function isDeclareGlobal(statement: ts.Statement): statement is ts.ModuleDeclaration {
  // eslint-disable-next-line no-bitwise
  return ts.isModuleDeclaration(statement) && (statement.flags & ts.NodeFlags.GlobalAugmentation) !== 0;
}
