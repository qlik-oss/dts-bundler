import ts from "typescript";
import type { AstPrinter } from "./ast-printer";
import { collectBindingIdentifiersFromName, hasBindingPatternInitializer } from "./helpers/binding-identifiers";
import { normalizePrintedStatement } from "./helpers/print-normalizer";
import { ExportKind, type TypeDeclaration } from "./types";

/**
 * Emit variable declaration statements for a group of `TypeDeclaration`s.
 * This class is responsible for reconstructing or normalizing `var/let/const`
 * declarations so they can be emitted in the generated `.d.ts` bundle with
 * appropriate `declare`/`export` modifiers and preserved type information.
 */
export class VariableDeclarationEmitter {
  private checker: ts.TypeChecker;
  private addExtraDefaultExport: (name: string) => void;
  private printer: AstPrinter;
  private getRenameMap: (declarations: TypeDeclaration[]) => Map<string, string>;

  /**
   * @param checker - TypeScript `TypeChecker` used to synthesize type nodes.
   * @param addExtraDefaultExport - Callback invoked when an extra default export
   *   alias must be emitted for `default`-only patterns.
   * @param printer - `AstPrinter` used to print synthesized AST nodes.
   * @param getRenameMap - Function returning a rename map for a group of declarations.
   */
  constructor(
    checker: ts.TypeChecker,
    addExtraDefaultExport: (name: string) => void,
    printer: AstPrinter,
    getRenameMap: (declarations: TypeDeclaration[]) => Map<string, string>,
  ) {
    this.checker = checker;
    this.addExtraDefaultExport = addExtraDefaultExport;
    this.printer = printer;
    this.getRenameMap = getRenameMap;
  }

  generateVariableStatementLines(statement: ts.VariableStatement, declarations: TypeDeclaration[]): string[] {
    /**
     * Given an original `VariableStatement` AST node and its associated
     * `TypeDeclaration` records, produce one or more output lines that
     * represent the exported/declared variables for the bundle. Handles
     * grouping by exported vs non-exported and special handling for
     * default-only export patterns.
     */
    const orderedDeclarations = [...declarations].sort((a, b) => {
      const aPos = a.variableDeclaration?.pos ?? 0;
      const bPos = b.variableDeclaration?.pos ?? 0;
      return aPos - bPos;
    });

    const hasDefaultOnly = orderedDeclarations.some((decl) => decl.exportInfo.kind === ExportKind.DefaultOnly);
    if (hasDefaultOnly) {
      for (const decl of orderedDeclarations) {
        if (VariableDeclarationEmitter.shouldExportDeclaration(decl)) {
          this.addExtraDefaultExport(decl.normalizedName);
        }
      }

      const statementNode = this.buildVariableStatement(statement, orderedDeclarations, false);
      if (!statementNode) {
        return [];
      }

      const preserveJsDoc = VariableDeclarationEmitter.shouldPreserveJsDoc(orderedDeclarations, false);
      return [this.printStatement(statementNode, statement, orderedDeclarations, preserveJsDoc)];
    }

    const groups = new Map<boolean, TypeDeclaration[]>();
    for (const decl of orderedDeclarations) {
      const shouldExport = VariableDeclarationEmitter.shouldExportDeclaration(decl);

      const group = groups.get(shouldExport);
      if (group) {
        group.push(decl);
      } else {
        groups.set(shouldExport, [decl]);
      }
    }

    const lines: string[] = [];

    for (const shouldExport of [false, true]) {
      const group = groups.get(shouldExport);
      if (!group || group.length === 0) {
        continue;
      }

      const statementNode = this.buildVariableStatement(statement, group, shouldExport);
      if (!statementNode) {
        continue;
      }

      const preserveJsDoc = VariableDeclarationEmitter.shouldPreserveJsDoc(group, shouldExport);
      lines.push(this.printStatement(statementNode, statement, group, preserveJsDoc));
    }

    return lines;
  }

  private buildVariableStatement(
    statement: ts.VariableStatement,
    declarations: TypeDeclaration[],
    shouldExport: boolean,
  ): ts.VariableStatement | null {
    /**
     * Build a new `VariableStatement` AST for the provided declarations.
     * Returns null when nothing meaningful can be emitted.
     */
    const declarationList = this.buildVariableDeclarationList(statement, declarations);
    if (!declarationList) {
      return null;
    }

    const modifiers: ts.Modifier[] = [];
    if (shouldExport) {
      modifiers.push(ts.factory.createModifier(ts.SyntaxKind.ExportKeyword));
    }
    modifiers.push(ts.factory.createModifier(ts.SyntaxKind.DeclareKeyword));

    const variableStatement = ts.factory.createVariableStatement(modifiers, declarationList);
    const sourceFile = statement.getSourceFile();
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!sourceFile) {
      const pos = statement.pos;
      const end = statement.end;
      ts.setTextRange(variableStatement, { pos, end });
      return variableStatement;
    }
    const pos = statement.pos >= 0 ? statement.pos : 0;
    const end = statement.end >= 0 ? statement.end : pos;
    ts.setTextRange(variableStatement, { pos, end });
    return variableStatement;
  }

  private buildVariableDeclarationList(
    statement: ts.VariableStatement,
    declarations: TypeDeclaration[],
  ): ts.VariableDeclarationList | null {
    /**
     * Construct an appropriate `VariableDeclarationList` for the given
     * declarations. This handles destructuring patterns (expanding to
     * individual identifiers when safe), preserves initializers for
     * literal consts, and synthesizes type nodes when necessary.
     */
    const statementDeclarations = statement.declarationList.declarations;
    const hasBindingPattern = statementDeclarations.some(
      (decl) => ts.isObjectBindingPattern(decl.name) || ts.isArrayBindingPattern(decl.name),
    );

    if (hasBindingPattern) {
      if (hasBindingPatternInitializer(statementDeclarations)) {
        return statement.declarationList;
      }

      const allBindingPatterns = statementDeclarations.every(
        (decl) => ts.isObjectBindingPattern(decl.name) || ts.isArrayBindingPattern(decl.name),
      );

      if (!allBindingPatterns) {
        return statement.declarationList;
      }

      const identifiers: ts.Identifier[] = [];
      for (const decl of statementDeclarations) {
        identifiers.push(...collectBindingIdentifiersFromName(decl.name));
      }

      if (identifiers.length === 0) {
        return statement.declarationList;
      }

      const newDeclarations = identifiers.map((identifier) => {
        const type = this.checker.getTypeAtLocation(identifier);
        const typeNode = this.checker.typeToTypeNode(
          type,
          undefined,
          // eslint-disable-next-line no-bitwise
          ts.NodeBuilderFlags.NoTruncation |
            ts.NodeBuilderFlags.UseAliasDefinedOutsideCurrentScope |
            ts.NodeBuilderFlags.NoTypeReduction,
        );
        const name = ts.factory.createIdentifier(identifier.text);
        return ts.factory.createVariableDeclaration(name, undefined, typeNode, undefined);
      });

      return ts.factory.createVariableDeclarationList(newDeclarations, statement.declarationList.flags);
    }

    const newDeclarations: ts.VariableDeclaration[] = [];
    for (const decl of declarations) {
      const varDecl = decl.variableDeclaration;
      if (!varDecl || !ts.isIdentifier(varDecl.name)) {
        continue;
      }

      const name = ts.factory.createIdentifier(decl.normalizedName);
      const initializer = varDecl.initializer;
      const explicitType = varDecl.type ?? null;

      if (initializer && ts.isIdentifier(initializer) && decl.namespaceDependencies.has(initializer.text)) {
        const typeNode = ts.factory.createTypeQueryNode(ts.factory.createIdentifier(initializer.text));
        newDeclarations.push(ts.factory.createVariableDeclaration(name, undefined, typeNode, undefined));
        continue;
      }

      if (explicitType) {
        newDeclarations.push(ts.factory.createVariableDeclaration(name, undefined, explicitType, undefined));
        continue;
      }

      if (initializer && VariableDeclarationEmitter.shouldKeepInitializer(varDecl, this.checker)) {
        newDeclarations.push(ts.factory.createVariableDeclaration(name, undefined, undefined, initializer));
        continue;
      }

      let type = this.checker.getTypeAtLocation(varDecl.name);
      let typeNode: ts.TypeNode | undefined;

      if (varDecl.initializer) {
        // eslint-disable-next-line no-bitwise
        if ((type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) {
          type = this.checker.getTypeAtLocation(varDecl.initializer);
        }

        // eslint-disable-next-line no-bitwise
        if ((type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) {
          if (ts.isNumericLiteral(varDecl.initializer)) {
            typeNode = ts.factory.createLiteralTypeNode(ts.factory.createNumericLiteral(varDecl.initializer.text));
          } else if (ts.isStringLiteral(varDecl.initializer)) {
            typeNode = ts.factory.createLiteralTypeNode(ts.factory.createStringLiteral(varDecl.initializer.text));
          } else if (varDecl.initializer.kind === ts.SyntaxKind.TrueKeyword) {
            typeNode = ts.factory.createLiteralTypeNode(ts.factory.createTrue());
          } else if (varDecl.initializer.kind === ts.SyntaxKind.FalseKeyword) {
            typeNode = ts.factory.createLiteralTypeNode(ts.factory.createFalse());
          }
        }
      }

      if (!typeNode) {
        if (initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) {
          const functionType = this.buildFunctionTypeFromInitializer(initializer);
          if (functionType) {
            typeNode = functionType;
          }
        }
      }

      if (!typeNode) {
        typeNode = this.checker.typeToTypeNode(
          type,
          undefined,
          // eslint-disable-next-line no-bitwise
          ts.NodeBuilderFlags.NoTruncation |
            ts.NodeBuilderFlags.UseAliasDefinedOutsideCurrentScope |
            ts.NodeBuilderFlags.NoTypeReduction,
        );
      }

      newDeclarations.push(ts.factory.createVariableDeclaration(name, undefined, typeNode, undefined));
    }

    if (newDeclarations.length === 0) {
      return statement.declarationList;
    }

    return ts.factory.createVariableDeclarationList(newDeclarations, statement.declarationList.flags);
  }

  private buildFunctionTypeFromInitializer(
    initializer: ts.ArrowFunction | ts.FunctionExpression,
  ): ts.FunctionTypeNode | null {
    /**
     * Attempt to build a `FunctionTypeNode` from an initializer that is a
     * function expression or arrow function. Only returns a type node when
     * parameter types and/or return type can be determined.
     */
    const hasExplicitParamType = initializer.parameters.some((param) => Boolean(param.type));
    const hasExplicitReturnType = Boolean(initializer.type);
    if (!hasExplicitParamType && !hasExplicitReturnType) {
      return null;
    }
    const sourceFile = initializer.getSourceFile();
    const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed, removeComments: true });
    const typeParamText = initializer.typeParameters
      ? `<${initializer.typeParameters.map((param) => param.getText(sourceFile)).join(", ")}>`
      : "";

    const parameterText = initializer.parameters
      .map((param) => {
        const nameText = param.name.getText(sourceFile);
        const isOptional = Boolean(param.questionToken || param.initializer);
        const restPrefix = param.dotDotDotToken ? "..." : "";
        const typeText = param.type ? param.type.getText(sourceFile) : "any";
        const optionalText = isOptional ? "?" : "";
        return `${restPrefix}${nameText}${optionalText}: ${typeText}`;
      })
      .join(", ");

    let returnTypeText = initializer.type ? initializer.type.getText(sourceFile) : "";
    if (!returnTypeText) {
      const signature = this.checker.getSignatureFromDeclaration(initializer);
      if (signature) {
        const signatureReturnType = this.checker.getReturnTypeOfSignature(signature);
        const inferred = this.checker.typeToTypeNode(
          signatureReturnType,
          undefined,
          // eslint-disable-next-line no-bitwise
          ts.NodeBuilderFlags.NoTruncation |
            ts.NodeBuilderFlags.UseAliasDefinedOutsideCurrentScope |
            ts.NodeBuilderFlags.NoTypeReduction,
        );
        if (inferred) {
          returnTypeText = printer.printNode(ts.EmitHint.Unspecified, inferred, sourceFile);
        }
      }
    }

    const functionTypeText = `${typeParamText}(${parameterText}) => ${returnTypeText || "void"}`;
    return VariableDeclarationEmitter.parseFunctionTypeFromText(functionTypeText);
  }

  private static parseFunctionTypeFromText(typeText: string): ts.FunctionTypeNode | null {
    /**
     * Parse a textual function type into a `FunctionTypeNode` by creating
     * a temporary source file and extracting the alias's type node.
     */
    const sourceFile = ts.createSourceFile(
      "__type_parse__.ts",
      `type __T = ${typeText};`,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const statement = sourceFile.statements[0];
    if (ts.isTypeAliasDeclaration(statement)) {
      const typeNode = statement.type;
      VariableDeclarationEmitter.markSynthesized(typeNode);
      return ts.isFunctionTypeNode(typeNode) ? typeNode : null;
    }
    return null;
  }

  private static markSynthesized(node: ts.Node): void {
    /**
     * Mark a synthesized AST subtree so it prints without comments and
     * appears as generated (no meaningful text range).
     */
    ts.setTextRange(node, { pos: -1, end: -1 });
    ts.setEmitFlags(node, ts.EmitFlags.NoComments);
    node.forEachChild((child) => {
      VariableDeclarationEmitter.markSynthesized(child);
    });
  }

  private printStatement(
    statementNode: ts.VariableStatement,
    sourceStatement: ts.VariableStatement,
    declarations: TypeDeclaration[],
    preserveJsDoc: boolean,
  ): string {
    /**
     * Print a synthesized `VariableStatement` using the configured
     * `AstPrinter` and normalize whitespace/comments relative to the
     * original `sourceStatement`.
     */
    const renameMap = this.getRenameMap(declarations);
    const renameMapToUse = renameMap.size > 0 ? renameMap : undefined;
    const sourceFile = sourceStatement.getSourceFile();
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!sourceFile) {
      const fallbackSource = statementNode.getSourceFile();
      const printed = this.printer.printStatement(statementNode, fallbackSource, { renameMap: renameMapToUse });
      return normalizePrintedStatement(printed, sourceStatement, "", { preserveJsDoc });
    }
    const printed = this.printer.printStatement(statementNode, sourceFile, { renameMap: renameMapToUse });
    const originalText = sourceStatement.getText(sourceFile);
    return normalizePrintedStatement(printed, sourceStatement, originalText, { preserveJsDoc });
  }

  private static shouldExportDeclaration(decl: TypeDeclaration): boolean {
    const kind = decl.exportInfo.kind;
    if (kind === ExportKind.Equals || kind === ExportKind.DefaultOnly) {
      return false;
    }

    return kind === ExportKind.Named || kind === ExportKind.NamedAndDefault || decl.exportInfo.wasOriginallyExported;
  }

  private static shouldKeepInitializer(decl: ts.VariableDeclaration, checker: ts.TypeChecker): boolean {
    /**
     * Decide whether a variable initializer should be preserved in the
     * emitted `.d.ts`. Generally only `const` literal initializers are kept
     * to preserve literal types.
     */
    if (!decl.initializer) {
      return false;
    }

    if (decl.type) {
      return false;
    }

    const list = decl.parent as ts.Node | undefined;
    if (!list || !ts.isVariableDeclarationList(list)) {
      return false;
    }
    // Only preserve initializers for const declarations
    // eslint-disable-next-line no-bitwise
    if ((list.flags & ts.NodeFlags.Const) === 0) {
      return false;
    }

    const type = checker.getTypeAtLocation(decl.initializer);

    if (type.isLiteral()) {
      return true;
    }

    if (type.isUnion()) {
      return type.types.every((member) => member.isLiteral());
    }

    return false;
  }

  private static shouldPreserveJsDoc(declarations: TypeDeclaration[], shouldExport: boolean): boolean {
    /**
     * Determine whether JSDoc comments should be preserved for a group of
     * declarations. Preserves JSDoc for exported groups and for default-only
     * patterns.
     */
    if (shouldExport) {
      return true;
    }

    return declarations.some(
      (decl) => decl.exportInfo.kind === ExportKind.Default || decl.exportInfo.kind === ExportKind.DefaultOnly,
    );
  }
}
