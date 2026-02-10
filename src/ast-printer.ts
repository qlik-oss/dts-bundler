import ts from "typescript";

/**
 * Options that control how AST nodes are printed.
 *
 * - `renameMap` maps identifier names to their printed replacements.
 * - `qualifiedNameMap` maps dotted qualified names (e.g. "ns.Type") to a replacement identifier.
 * - `typeChecker` is used to detect global references when preserving them.
 * - `preserveGlobalReferences` prevents renaming of identifiers resolved to global symbols.
 * - `namespaceImportNames` lists namespace import identifiers that should be preserved when printing qualified names.
 * - `stripImportType` provides custom logic to convert `import("x").T` nodes to a type/query when desired.
 */
export interface AstPrintOptions {
  renameMap?: Map<string, string>;
  qualifiedNameMap?: Map<string, string>;
  typeChecker?: ts.TypeChecker;
  preserveGlobalReferences?: boolean;
  namespaceImportNames?: Set<string>;
  stripImportType?: (node: ts.ImportTypeNode) => boolean;
}

export class AstPrinter {
  /** The underlying TypeScript `Printer` used to emit text. */
  private printer: ts.Printer;

  /**
   * Create a new `AstPrinter` instance.
   * The printer is configured to preserve comments and use LF line endings.
   */
  constructor() {
    this.printer = ts.createPrinter({
      newLine: ts.NewLineKind.LineFeed,
      removeComments: false,
    });
  }

  /**
   * Print an arbitrary `ts.Node` to source text.
   * If `options` provides rename/qualified-name maps or a `stripImportType` hook,
   * the node will be transformed before printing to apply those replacements.
   *
   * @param node - The AST node to print.
   * @param sourceFile - The `SourceFile` context used by the printer.
   * @param options - Optional printing/transformation options.
   * @returns The printed TypeScript text for `node`.
   */
  printNode(node: ts.Node, sourceFile: ts.SourceFile, options: AstPrintOptions = {}): string {
    const transformed =
      options.renameMap || options.qualifiedNameMap || options.stripImportType
        ? AstPrinter.applyRenameTransformer(
            node,
            options.renameMap,
            options.qualifiedNameMap,
            options.typeChecker,
            options.preserveGlobalReferences,
            options.namespaceImportNames,
            options.stripImportType,
          )
        : node;
    return this.printer.printNode(ts.EmitHint.Unspecified, transformed, sourceFile);
  }

  /**
   * Print a `ts.Statement` to source text, applying the same transformation rules
   * as `printNode` when options are supplied.
   *
   * @param statement - The statement to print.
   * @param sourceFile - The `SourceFile` context used by the printer.
   * @param options - Optional printing/transformation options.
   * @returns The printed TypeScript text for `statement`.
   */
  printStatement(statement: ts.Statement, sourceFile: ts.SourceFile, options: AstPrintOptions = {}): string {
    const transformed =
      options.renameMap || options.qualifiedNameMap || options.stripImportType
        ? AstPrinter.applyRenameTransformer(
            statement,
            options.renameMap,
            options.qualifiedNameMap,
            options.typeChecker,
            options.preserveGlobalReferences,
            options.namespaceImportNames,
            options.stripImportType,
          )
        : statement;
    return this.printer.printNode(ts.EmitHint.Unspecified, transformed, sourceFile);
  }

  /**
   * Create a transformer that applies identifier and qualified-name renames.
   * This transformer also supports:
   * - converting `import("x").T` nodes to type/query nodes via `stripImportType`;
   * - preserving namespace-import identifiers and global references when requested.
   *
   * Note: This is an internal helper but is documented so callers understand
   * the transformation behaviour when debugging printed output.
   *
   * @internal
   */
  private static applyRenameTransformer<T extends ts.Node>(
    node: T,
    renameMap?: Map<string, string>,
    qualifiedNameMap?: Map<string, string>,
    typeChecker?: ts.TypeChecker,
    preserveGlobalReferences?: boolean,
    namespaceImportNames?: Set<string>,
    stripImportType?: (node: ts.ImportTypeNode) => boolean,
  ): T {
    const transformer: ts.TransformerFactory<T> = (context) => {
      const isGlobalReference = (identifier: ts.Identifier): boolean => {
        if (!typeChecker) {
          return false;
        }

        interface Ts54CompatTypeChecker extends ts.TypeChecker {
          resolveName(
            name: string,
            location: ts.Node | undefined,
            meaning: ts.SymbolFlags,
            excludeGlobals: boolean,
          ): ts.Symbol | undefined;
        }

        const symbol = typeChecker.getSymbolAtLocation(identifier);
        if (!symbol) {
          return false;
        }

        const tsSymbolFlagsAll = -1 as ts.SymbolFlags;
        const globalSymbol = (typeChecker as Ts54CompatTypeChecker).resolveName(
          identifier.text,
          undefined,
          tsSymbolFlagsAll,
          false,
        );
        return !!globalSymbol && globalSymbol === symbol;
      };

      const visit: ts.Visitor = (current) => {
        if (ts.isImportTypeNode(current)) {
          const qualifier = current.qualifier;
          const shouldStrip = qualifier ? (stripImportType?.(current) ?? false) : false;
          const visitedTypeArguments = current.typeArguments?.map((arg) => ts.visitNode(arg, visit) as ts.TypeNode);

          if (shouldStrip && qualifier) {
            const newQualifier = ts.visitNode(qualifier, visit) as ts.EntityName;
            if (current.isTypeOf) {
              const replacement = ts.factory.createTypeQueryNode(newQualifier, visitedTypeArguments);
              ts.setTextRange(replacement, current);
              return replacement;
            }

            const replacement = ts.factory.createTypeReferenceNode(newQualifier, visitedTypeArguments);
            ts.setTextRange(replacement, current);
            return replacement;
          }

          if (!current.typeArguments || !visitedTypeArguments) {
            return current;
          }

          const hasChanges = visitedTypeArguments.some((arg, index) => arg !== current.typeArguments?.[index]);
          if (!hasChanges) {
            return current;
          }

          const replacement = ts.factory.createImportTypeNode(
            current.argument,
            current.attributes,
            current.qualifier,
            visitedTypeArguments,
            current.isTypeOf,
          );
          ts.setTextRange(replacement, current);
          return replacement;
        }

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
            if (current.text === "global") {
              return current;
            }
            const renamed = renameMap?.get(current.text);
            if (!renamed || renamed === current.text) {
              return current;
            }
          }
          if (
            parent &&
            ts.isImportTypeNode(parent) &&
            parent.qualifier === current &&
            !(stripImportType?.(parent) ?? false)
          ) {
            return current;
          }
          if (
            namespaceImportNames &&
            parent &&
            ((ts.isQualifiedName(parent) && parent.right === current) ||
              (ts.isPropertyAccessExpression(parent) && parent.name === current))
          ) {
            const left = ts.isQualifiedName(parent) ? parent.left : parent.expression;
            if (ts.isIdentifier(left) && namespaceImportNames.has(left.text)) {
              return current;
            }
          }
          if (preserveGlobalReferences && isGlobalReference(current)) {
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

  /**
   * Convert a dotted name string into a `ts.EntityName` (`Identifier` / `QualifiedName`).
   *
   * @param name - Dotted name like "A.B.C".
   * @returns A `ts.EntityName` representing the dotted path.
   */
  private static createQualifiedNameFromString(name: string): ts.EntityName {
    const parts = name.split(".");
    let current: ts.EntityName = ts.factory.createIdentifier(parts[0]);
    for (let i = 1; i < parts.length; i += 1) {
      current = ts.factory.createQualifiedName(current, ts.factory.createIdentifier(parts[i]));
    }
    return current;
  }

  /**
   * Convert a dotted name string into a `ts.Expression` using `PropertyAccessExpression`.
   *
   * @param name - Dotted name like "a.b.c".
   * @returns A `ts.Expression` representing the property access chain.
   */
  private static createPropertyAccessFromString(name: string): ts.Expression {
    const parts = name.split(".");
    let current: ts.Expression = ts.factory.createIdentifier(parts[0]);
    for (let i = 1; i < parts.length; i += 1) {
      current = ts.factory.createPropertyAccessExpression(current, parts[i]);
    }
    return current;
  }
}
