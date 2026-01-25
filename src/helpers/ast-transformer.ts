import ts from "typescript";

export type ModifiersMap = Record<ts.ModifierSyntaxKind, boolean>;

const modifiersPriority: Partial<Record<ts.ModifierSyntaxKind, number>> = {
  [ts.SyntaxKind.ExportKeyword]: 4,
  [ts.SyntaxKind.DefaultKeyword]: 3,
  [ts.SyntaxKind.DeclareKeyword]: 2,
  [ts.SyntaxKind.AsyncKeyword]: 1,
  [ts.SyntaxKind.ConstKeyword]: 1,
};

export function getModifiers(node: ts.Node): readonly ts.Modifier[] | undefined {
  if (!ts.canHaveModifiers(node)) {
    return undefined;
  }

  return ts.getModifiers(node);
}

export function modifiersToMap(modifiers: readonly ts.Modifier[] | undefined | null): ModifiersMap {
  const safe = modifiers ?? [];
  const result: ModifiersMap = {} as Record<ts.ModifierSyntaxKind, boolean>;

  for (const modifier of safe) {
    result[modifier.kind] = true;
  }

  return result;
}

export function modifiersMapToArray(modifiersMap: ModifiersMap): ts.Modifier[] {
  return Object.entries(modifiersMap)
    .filter(([, include]) => include)
    .map(([kind]) => ts.factory.createModifier(Number(kind)))
    .sort((a, b) => {
      const aValue = modifiersPriority[a.kind as ts.ModifierSyntaxKind] || 0;
      const bValue = modifiersPriority[b.kind as ts.ModifierSyntaxKind] || 0;
      return bValue - aValue;
    });
}

export function recreateRootLevelNodeWithModifiers(
  node: ts.Node,
  modifiersMap: ModifiersMap,
  newName?: string,
  keepComments = true,
): ts.Node {
  const newNode = recreateRootLevelNodeWithModifiersImpl(node, modifiersMap, newName);

  if (keepComments) {
    ts.setCommentRange(newNode, ts.getCommentRange(node));
  }

  ts.setTextRange(newNode, node);

  return newNode;
}

function recreateRootLevelNodeWithModifiersImpl(node: ts.Node, modifiersMap: ModifiersMap, newName?: string): ts.Node {
  const modifiers = modifiersMapToArray(modifiersMap);

  if (ts.isClassDeclaration(node)) {
    return ts.factory.createClassDeclaration(
      modifiers,
      newName || node.name,
      node.typeParameters,
      node.heritageClauses,
      node.members,
    );
  }

  if (ts.isEnumDeclaration(node)) {
    return ts.factory.createEnumDeclaration(modifiers, newName || node.name, node.members);
  }

  if (ts.isExportAssignment(node)) {
    return ts.factory.createExportAssignment(modifiers, node.isExportEquals, node.expression);
  }

  if (ts.isExportDeclaration(node)) {
    interface Ts53CompatExportDeclaration extends ts.ExportDeclaration {
      attributes?: ts.ExportDeclaration["assertClause"];
    }

    return ts.factory.createExportDeclaration(
      modifiers,
      node.isTypeOnly,
      node.exportClause,
      node.moduleSpecifier,
      (node as Ts53CompatExportDeclaration).attributes || node.assertClause,
    );
  }

  if (ts.isFunctionDeclaration(node)) {
    return ts.factory.createFunctionDeclaration(
      modifiers,
      node.asteriskToken,
      newName || node.name,
      node.typeParameters,
      node.parameters,
      node.type,
      node.body,
    );
  }

  if (ts.isImportDeclaration(node)) {
    interface Ts53CompatImportDeclaration extends ts.ImportDeclaration {
      attributes?: ts.ImportDeclaration["assertClause"];
    }

    return ts.factory.createImportDeclaration(
      modifiers,
      node.importClause,
      node.moduleSpecifier,
      (node as Ts53CompatImportDeclaration).attributes || node.assertClause,
    );
  }

  if (ts.isImportEqualsDeclaration(node)) {
    return ts.factory.createImportEqualsDeclaration(
      modifiers,
      node.isTypeOnly,
      newName || node.name,
      node.moduleReference,
    );
  }

  if (ts.isInterfaceDeclaration(node)) {
    return ts.factory.createInterfaceDeclaration(
      modifiers,
      newName || node.name,
      node.typeParameters,
      node.heritageClauses,
      node.members,
    );
  }

  if (ts.isModuleDeclaration(node)) {
    return ts.factory.createModuleDeclaration(modifiers, node.name, node.body, node.flags);
  }

  if (ts.isTypeAliasDeclaration(node)) {
    return ts.factory.createTypeAliasDeclaration(modifiers, newName || node.name, node.typeParameters, node.type);
  }

  if (ts.isVariableStatement(node)) {
    return ts.factory.createVariableStatement(modifiers, node.declarationList);
  }

  throw new Error(`Unknown top-level node kind (with modifiers): ${ts.SyntaxKind[node.kind]}`);
}
