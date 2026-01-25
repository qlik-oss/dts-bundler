import ts from "typescript";
import type { AstPrinter } from "./ast-printer.js";
import { normalizePrintedStatement } from "./helpers/print-normalizer.js";
import { ExportKind, type TypeDeclaration } from "./types.js";

export class VariableDeclarationEmitter {
  private checker: ts.TypeChecker;
  private addExtraDefaultExport: (name: string) => void;
  private printer: AstPrinter;
  private getRenameMap: (declarations: TypeDeclaration[]) => Map<string, string>;

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

      return [this.printStatement(statementNode, statement, orderedDeclarations)];
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

      lines.push(this.printStatement(statementNode, statement, group));
    }

    return lines;
  }

  private buildVariableStatement(
    statement: ts.VariableStatement,
    declarations: TypeDeclaration[],
    shouldExport: boolean,
  ): ts.VariableStatement | null {
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
    ts.setTextRange(variableStatement, { pos: statement.getStart(), end: statement.end });
    return variableStatement;
  }

  private buildVariableDeclarationList(
    statement: ts.VariableStatement,
    declarations: TypeDeclaration[],
  ): ts.VariableDeclarationList | null {
    const statementDeclarations = statement.declarationList.declarations;
    const hasBindingPattern = statementDeclarations.some(
      (decl) => ts.isObjectBindingPattern(decl.name) || ts.isArrayBindingPattern(decl.name),
    );

    if (hasBindingPattern) {
      const allBindingPatterns = statementDeclarations.every(
        (decl) => ts.isObjectBindingPattern(decl.name) || ts.isArrayBindingPattern(decl.name),
      );

      if (!allBindingPatterns) {
        return statement.declarationList;
      }

      const identifiers: ts.Identifier[] = [];
      for (const decl of statementDeclarations) {
        VariableDeclarationEmitter.collectBindingIdentifiers(decl.name, identifiers);
      }

      if (identifiers.length === 0) {
        return statement.declarationList;
      }

      const newDeclarations = identifiers.map((identifier) => {
        const type = this.checker.getTypeAtLocation(identifier);
        const typeNode = this.checker.typeToTypeNode(type, undefined, ts.NodeBuilderFlags.NoTruncation);
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

      const type = this.checker.getTypeAtLocation(varDecl.name);
      const typeNode = this.checker.typeToTypeNode(type, undefined, ts.NodeBuilderFlags.NoTruncation);
      newDeclarations.push(ts.factory.createVariableDeclaration(name, undefined, typeNode, undefined));
    }

    if (newDeclarations.length === 0) {
      return statement.declarationList;
    }

    return ts.factory.createVariableDeclarationList(newDeclarations, statement.declarationList.flags);
  }

  private printStatement(
    statementNode: ts.VariableStatement,
    sourceStatement: ts.VariableStatement,
    declarations: TypeDeclaration[],
  ): string {
    const renameMap = this.getRenameMap(declarations);
    const printed = this.printer.printStatement(statementNode, sourceStatement.getSourceFile(), { renameMap });
    return normalizePrintedStatement(
      printed,
      sourceStatement,
      sourceStatement.getText(sourceStatement.getSourceFile()),
    );
  }

  private static shouldExportDeclaration(decl: TypeDeclaration): boolean {
    const kind = decl.exportInfo.kind;
    if (kind === ExportKind.Equals || kind === ExportKind.DefaultOnly) {
      return false;
    }

    return kind === ExportKind.Named || decl.exportInfo.wasOriginallyExported;
  }

  private static shouldKeepInitializer(decl: ts.VariableDeclaration, checker: ts.TypeChecker): boolean {
    if (!decl.initializer) {
      return false;
    }

    if (decl.type) {
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

  private static collectBindingIdentifiers(name: ts.BindingName, identifiers: ts.Identifier[]): void {
    if (ts.isIdentifier(name)) {
      identifiers.push(name);
      return;
    }

    if (ts.isObjectBindingPattern(name)) {
      for (const element of name.elements) {
        if (ts.isBindingElement(element)) {
          VariableDeclarationEmitter.collectBindingIdentifiers(element.name, identifiers);
        }
      }
      return;
    }

    if (ts.isArrayBindingPattern(name)) {
      for (const element of name.elements) {
        if (ts.isOmittedExpression(element)) {
          continue;
        }
        if (ts.isBindingElement(element)) {
          VariableDeclarationEmitter.collectBindingIdentifiers(element.name, identifiers);
        }
      }
    }
  }
}
