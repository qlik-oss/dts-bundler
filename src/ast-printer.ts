import ts from "typescript";

export interface AstPrintOptions {
  renameMap?: Map<string, string>;
  qualifiedNameMap?: Map<string, string>;
}

export class AstPrinter {
  private printer: ts.Printer;

  constructor() {
    this.printer = ts.createPrinter({
      newLine: ts.NewLineKind.LineFeed,
      removeComments: false,
    });
  }

  printNode(node: ts.Node, sourceFile: ts.SourceFile, options: AstPrintOptions = {}): string {
    const transformed =
      options.renameMap || options.qualifiedNameMap
        ? AstPrinter.applyRenameTransformer(node, options.renameMap, options.qualifiedNameMap)
        : node;
    return this.printer.printNode(ts.EmitHint.Unspecified, transformed, sourceFile);
  }

  printStatement(statement: ts.Statement, sourceFile: ts.SourceFile, options: AstPrintOptions = {}): string {
    const transformed =
      options.renameMap || options.qualifiedNameMap
        ? AstPrinter.applyRenameTransformer(statement, options.renameMap, options.qualifiedNameMap)
        : statement;
    return this.printer.printNode(ts.EmitHint.Unspecified, transformed, sourceFile);
  }

  private static applyRenameTransformer<T extends ts.Node>(
    node: T,
    renameMap?: Map<string, string>,
    qualifiedNameMap?: Map<string, string>,
  ): T {
    const transformer: ts.TransformerFactory<T> = (context) => {
      const visit: ts.Visitor = (current) => {
        if (qualifiedNameMap && ts.isQualifiedName(current)) {
          const left = current.left;
          const right = current.right;
          if (ts.isIdentifier(left) && ts.isIdentifier(right)) {
            const key = `${left.text}.${right.text}`;
            const replacementName = qualifiedNameMap.get(key);
            if (replacementName) {
              const replacement = ts.factory.createIdentifier(replacementName);
              ts.setTextRange(replacement, current);
              return replacement;
            }
          }
        }

        if (qualifiedNameMap && ts.isPropertyAccessExpression(current)) {
          const expression = current.expression;
          const name = current.name;
          if (ts.isIdentifier(expression) && ts.isIdentifier(name)) {
            const key = `${expression.text}.${name.text}`;
            const replacementName = qualifiedNameMap.get(key);
            if (replacementName) {
              const replacement = ts.factory.createIdentifier(replacementName);
              ts.setTextRange(replacement, current);
              return replacement;
            }
          }
        }

        if (ts.isIdentifier(current)) {
          const parent = (current as Omit<ts.Node, "parent"> & { parent?: ts.Node }).parent;
          if (parent && ts.isModuleDeclaration(parent) && parent.name === current) {
            return current;
          }
          const renamed = renameMap?.get(current.text);
          if (renamed && renamed !== current.text) {
            if (renamed.includes(".")) {
              if (parent && ts.isQualifiedName(parent) && parent.left === current) {
                const replacement = AstPrinter.createQualifiedNameFromString(renamed);
                ts.setTextRange(replacement, current);
                return replacement;
              }
              if (parent && ts.isPropertyAccessExpression(parent) && parent.expression === current) {
                const replacement = AstPrinter.createPropertyAccessFromString(renamed);
                ts.setTextRange(replacement, current);
                return replacement;
              }
            }

            const replacement = ts.factory.createIdentifier(renamed);
            ts.setTextRange(replacement, current);
            return replacement;
          }
        }

        if (ts.isQualifiedName(current)) {
          const left = ts.visitNode(current.left, visit) as ts.EntityName;
          const right = ts.visitNode(current.right, visit) as ts.Identifier;
          if (left !== current.left || right !== current.right) {
            const replacement = ts.factory.createQualifiedName(left, right);
            ts.setTextRange(replacement, current);
            return replacement;
          }
        }

        if (ts.isPropertyAccessExpression(current)) {
          const expression = ts.visitNode(current.expression, visit) as ts.Expression;
          const name = ts.visitNode(current.name, visit) as ts.Identifier;
          if (expression !== current.expression || name !== current.name) {
            const replacement = ts.factory.createPropertyAccessExpression(expression, name);
            ts.setTextRange(replacement, current);
            return replacement;
          }
        }

        return ts.visitEachChild(current, visit, context);
      };

      return (rootNode) => ts.visitNode(rootNode, visit) as T;
    };

    const result = ts.transform(node, [transformer]);
    const transformed = result.transformed[0] as T;
    result.dispose();
    return transformed;
  }

  private static createQualifiedNameFromString(name: string): ts.EntityName {
    const parts = name.split(".");
    let current: ts.EntityName = ts.factory.createIdentifier(parts[0]);
    for (let i = 1; i < parts.length; i += 1) {
      current = ts.factory.createQualifiedName(current, ts.factory.createIdentifier(parts[i]));
    }
    return current;
  }

  private static createPropertyAccessFromString(name: string): ts.Expression {
    const parts = name.split(".");
    let current: ts.Expression = ts.factory.createIdentifier(parts[0]);
    for (let i = 1; i < parts.length; i += 1) {
      current = ts.factory.createPropertyAccessExpression(current, parts[i]);
    }
    return current;
  }
}
