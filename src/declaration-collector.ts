import ts from "typescript";
import {
  getDeclarationName,
  hasDefaultModifier,
  hasExportModifier,
  isDeclaration,
  isDeclareGlobal,
} from "./declaration-utils.js";
import type { FileCollector } from "./file-collector.js";
import { collectBindingElementsFromDeclarations } from "./helpers/binding-identifiers.js";
import type { TypeRegistry } from "./registry.js";
import { ExportKind, TypeDeclaration, type ExportInfo } from "./types.js";

export class DeclarationCollector {
  private registry: TypeRegistry;
  private fileCollector: FileCollector;
  private options: { inlineDeclareGlobals: boolean; inlineDeclareExternals: boolean };
  private defaultExportCounter = 0;

  constructor(
    registry: TypeRegistry,
    fileCollector: FileCollector,
    options: { inlineDeclareGlobals: boolean; inlineDeclareExternals: boolean },
  ) {
    this.registry = registry;
    this.fileCollector = fileCollector;
    this.options = options;
  }

  private registerDeclaration(declaration: TypeDeclaration, filePath: string): void {
    // eslint-disable-next-line no-param-reassign
    declaration.isFromInlinedLibrary = this.fileCollector.isFromInlinedLibrary(filePath);
    this.registry.register(declaration);
  }

  collectDeclarations(
    filePath: string,
    sourceFile: ts.SourceFile,
    isEntry: boolean,
    onDefaultExportName: (name: string) => void,
  ): void {
    for (const statement of sourceFile.statements) {
      if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
        this.parseExportAssignment(statement, filePath, sourceFile, isEntry, onDefaultExportName);
        continue;
      }

      if (!isDeclaration(statement)) {
        continue;
      }

      if (
        ts.isModuleDeclaration(statement) &&
        ts.isStringLiteral(statement.name) &&
        statement.body &&
        ts.isModuleBlock(statement.body)
      ) {
        this.parseAmbientModule(statement, filePath, sourceFile);
        continue;
      }

      if (
        ts.isModuleDeclaration(statement) &&
        ts.isIdentifier(statement.name) &&
        statement.body &&
        ts.isModuleBlock(statement.body)
      ) {
        this.parseModuleAugmentation(statement, filePath, sourceFile, isEntry);
        continue;
      }

      this.parseDeclaration(statement, filePath, sourceFile, isEntry, onDefaultExportName);
    }
  }

  private parseAmbientModule(moduleDecl: ts.ModuleDeclaration, filePath: string, sourceFile: ts.SourceFile): void {
    if (!moduleDecl.body || !ts.isModuleBlock(moduleDecl.body)) {
      return;
    }

    const moduleName = moduleDecl.name.text;
    // For declare module statements, check if it resolves to a local file
    // or if it's a module that should be inlined
    const resolvedModule = this.fileCollector.resolveModuleSpecifier(filePath, moduleName);
    const shouldInline =
      this.fileCollector.shouldInline(moduleName, filePath) ||
      (resolvedModule ? this.fileCollector.shouldInlineFilePath(resolvedModule) : false);

    if (!shouldInline) {
      if (!this.options.inlineDeclareExternals) {
        return;
      }

      const name = getDeclarationName(moduleDecl);
      if (!name) {
        return;
      }

      const exportInfo: ExportInfo = {
        kind: ExportKind.Named,
        wasOriginallyExported: true,
      };

      const declaration = new TypeDeclaration(name, filePath, moduleDecl, sourceFile, exportInfo);
      declaration.isTypeOnly = DeclarationCollector.isTypeOnlyDeclaration(moduleDecl);

      this.registerDeclaration(declaration, filePath);
      return;
    }

    for (const statement of moduleDecl.body.statements) {
      if (!isDeclaration(statement)) {
        continue;
      }

      const name = getDeclarationName(statement);
      if (!name) continue;

      const hasExport = hasExportModifier(statement);
      const exportInfo: ExportInfo = {
        kind: hasExport ? ExportKind.Named : ExportKind.NotExported,
        wasOriginallyExported: hasExport,
      };

      const declaration = new TypeDeclaration(name, filePath, statement, sourceFile, exportInfo);
      declaration.isTypeOnly = DeclarationCollector.isTypeOnlyDeclaration(statement);
      declaration.forceInclude = true;
      this.registerDeclaration(declaration, filePath);
    }
  }

  private parseDeclaration(
    statement: ts.Statement,
    filePath: string,
    sourceFile: ts.SourceFile,
    isEntry: boolean,
    onDefaultExportName: (name: string) => void,
  ): void {
    if (isDeclareGlobal(statement) && !this.options.inlineDeclareGlobals) {
      return;
    }

    if (ts.isVariableStatement(statement)) {
      this.parseVariableStatement(statement, filePath, sourceFile, isEntry);
      return;
    }

    const name = getDeclarationName(statement);
    if (!name) {
      if (hasDefaultModifier(statement)) {
        this.registerAnonymousDefaultDeclaration(statement, filePath, sourceFile, isEntry, onDefaultExportName);
      }
      return;
    }

    const hasExport = hasExportModifier(statement);
    const hasDefaultExport = hasDefaultModifier(statement);
    const declareGlobal = isDeclareGlobal(statement);
    let isExported = isEntry ? hasExport : false;

    let wasOriginallyExported = this.fileCollector.isFromInlinedLibrary(filePath) ? hasExport : isExported;

    if (declareGlobal && this.options.inlineDeclareGlobals) {
      isExported = true;
      wasOriginallyExported = true;
    }

    const exportInfo: ExportInfo = {
      kind: isExported ? ExportKind.Named : ExportKind.NotExported,
      wasOriginallyExported,
    };

    if (hasDefaultExport) {
      exportInfo.kind = isEntry ? ExportKind.Default : ExportKind.DefaultOnly;
      wasOriginallyExported = true;
      if (isEntry) {
        onDefaultExportName(name);
      }
    }

    const declaration = new TypeDeclaration(name, filePath, statement, sourceFile, {
      ...exportInfo,
      wasOriginallyExported,
    });
    declaration.isTypeOnly = DeclarationCollector.isTypeOnlyDeclaration(statement);
    if (declareGlobal && this.options.inlineDeclareGlobals) {
      declaration.forceInclude = true;
    }
    this.registerDeclaration(declaration, filePath);
  }

  private parseExportAssignment(
    statement: ts.ExportAssignment,
    filePath: string,
    sourceFile: ts.SourceFile,
    isEntry: boolean,
    onDefaultExportName: (name: string) => void,
  ): void {
    if (ts.isIdentifier(statement.expression)) {
      return;
    }

    const syntheticName = this.getSyntheticDefaultExportName();
    const exportInfo: ExportInfo = {
      kind: isEntry ? ExportKind.Default : ExportKind.DefaultOnly,
      wasOriginallyExported: true,
    };

    const declarationNode = DeclarationCollector.createDefaultExportVariable(statement, syntheticName);
    const declaration = new TypeDeclaration(syntheticName, filePath, declarationNode, sourceFile, exportInfo);
    declaration.isTypeOnly = DeclarationCollector.isTypeOnlyDeclaration(declarationNode);

    if (ts.isVariableStatement(declarationNode)) {
      const varDecl = declarationNode.declarationList.declarations[0];
      declaration.variableDeclaration = varDecl;
    }

    this.registerDeclaration(declaration, filePath);

    if (isEntry) {
      onDefaultExportName(syntheticName);
    }
  }

  private registerAnonymousDefaultDeclaration(
    statement: ts.Statement,
    filePath: string,
    sourceFile: ts.SourceFile,
    isEntry: boolean,
    onDefaultExportName: (name: string) => void,
  ): void {
    if (!ts.isClassDeclaration(statement) && !ts.isFunctionDeclaration(statement)) {
      return;
    }

    const syntheticName = this.getSyntheticDefaultExportName();
    const exportInfo: ExportInfo = {
      kind: isEntry ? ExportKind.Default : ExportKind.DefaultOnly,
      wasOriginallyExported: true,
    };

    let namedNode: ts.Statement;

    if (ts.isClassDeclaration(statement)) {
      const modifiers = DeclarationCollector.stripDefaultModifiers(statement);
      namedNode = ts.factory.updateClassDeclaration(
        statement,
        modifiers,
        ts.factory.createIdentifier(syntheticName),
        statement.typeParameters,
        statement.heritageClauses,
        statement.members,
      );
    } else {
      const modifiers = DeclarationCollector.stripDefaultModifiers(statement);
      namedNode = ts.factory.updateFunctionDeclaration(
        statement,
        modifiers,
        statement.asteriskToken,
        ts.factory.createIdentifier(syntheticName),
        statement.typeParameters,
        statement.parameters,
        statement.type,
        statement.body,
      );
    }

    ts.setTextRange(namedNode, statement);
    const declaration = new TypeDeclaration(syntheticName, filePath, namedNode, sourceFile, exportInfo);
    declaration.isTypeOnly = DeclarationCollector.isTypeOnlyDeclaration(namedNode);
    this.registerDeclaration(declaration, filePath);

    if (isEntry) {
      onDefaultExportName(syntheticName);
    }
  }

  private static createDefaultExportVariable(statement: ts.ExportAssignment, name: string): ts.VariableStatement {
    const declaration = ts.factory.createVariableDeclaration(
      ts.factory.createIdentifier(name),
      undefined,
      undefined,
      statement.expression,
    );
    const declarationList = ts.factory.createVariableDeclarationList([declaration], ts.NodeFlags.Const);
    const variableStatement = ts.factory.createVariableStatement(undefined, declarationList);
    ts.setTextRange(variableStatement, statement);
    return variableStatement;
  }

  private getSyntheticDefaultExportName(): string {
    const current = this.defaultExportCounter;
    this.defaultExportCounter += 1;
    if (current === 0) {
      return "_default";
    }
    return `_default$${current}`;
  }

  private static stripDefaultModifiers(statement: ts.Statement): ts.Modifier[] | undefined {
    if (!ts.canHaveModifiers(statement)) {
      return undefined;
    }

    const modifiers = ts.getModifiers(statement) ?? [];
    const filtered = modifiers.filter(
      (mod) => mod.kind !== ts.SyntaxKind.DefaultKeyword && mod.kind !== ts.SyntaxKind.ExportKeyword,
    );
    return filtered.length > 0 ? filtered : undefined;
  }

  private parseVariableStatement(
    statement: ts.VariableStatement,
    filePath: string,
    sourceFile: ts.SourceFile,
    isEntry: boolean,
  ): void {
    const declarations = statement.declarationList.declarations;
    const hasBindingPattern = declarations.some(
      (decl) => ts.isObjectBindingPattern(decl.name) || ts.isArrayBindingPattern(decl.name),
    );

    const hasExport = hasExportModifier(statement);
    const declareGlobal = isDeclareGlobal(statement);

    if (hasBindingPattern) {
      const identifiers = collectBindingElementsFromDeclarations(declarations);
      if (identifiers.length === 0) {
        return;
      }

      for (const { identifier, element } of identifiers) {
        const name = identifier.text;
        let isExported = isEntry ? hasExport : false;
        let wasOriginallyExported = this.fileCollector.isFromInlinedLibrary(filePath) ? hasExport : isExported;

        if (declareGlobal && this.options.inlineDeclareGlobals) {
          isExported = true;
          wasOriginallyExported = true;
        }

        const exportInfo: ExportInfo = {
          kind: isExported ? ExportKind.Named : ExportKind.NotExported,
          wasOriginallyExported,
        };

        const declaration = new TypeDeclaration(name, filePath, statement, sourceFile, exportInfo);
        declaration.isTypeOnly = false;
        const synthetic = ts.factory.createVariableDeclaration(identifier, undefined, undefined, element.initializer);
        ts.setTextRange(synthetic, element);
        declaration.variableDeclaration = synthetic;
        this.registerDeclaration(declaration, filePath);
      }
      return;
    }

    for (const varDecl of declarations) {
      if (!ts.isIdentifier(varDecl.name)) {
        continue;
      }

      const name = varDecl.name.text;
      let isExported = isEntry ? hasExport : false;
      let wasOriginallyExported = this.fileCollector.isFromInlinedLibrary(filePath) ? hasExport : isExported;

      if (declareGlobal && this.options.inlineDeclareGlobals) {
        isExported = true;
        wasOriginallyExported = true;
      }

      const exportInfo: ExportInfo = {
        kind: isExported ? ExportKind.Named : ExportKind.NotExported,
        wasOriginallyExported,
      };

      const declaration = new TypeDeclaration(name, filePath, statement, sourceFile, exportInfo);
      declaration.isTypeOnly = false;
      declaration.variableDeclaration = varDecl;
      this.registerDeclaration(declaration, filePath);
    }
  }

  private parseModuleAugmentation(
    moduleDecl: ts.ModuleDeclaration,
    filePath: string,
    sourceFile: ts.SourceFile,
    isEntry: boolean,
  ): void {
    const name = getDeclarationName(moduleDecl);
    if (!name) {
      return;
    }

    const hasExport = hasExportModifier(moduleDecl);
    const declareGlobal = isDeclareGlobal(moduleDecl);
    let isExported = isEntry ? hasExport : false;
    let wasOriginallyExported = this.fileCollector.isFromInlinedLibrary(filePath) ? hasExport : isExported;

    if (declareGlobal && this.options.inlineDeclareGlobals) {
      isExported = true;
      wasOriginallyExported = true;
    }

    const exportInfo: ExportInfo = {
      kind: isExported ? ExportKind.Named : ExportKind.NotExported,
      wasOriginallyExported,
    };

    const declaration = new TypeDeclaration(name, filePath, moduleDecl, sourceFile, exportInfo);
    declaration.isTypeOnly = DeclarationCollector.isTypeOnlyDeclaration(moduleDecl);
    if (declareGlobal && this.options.inlineDeclareGlobals) {
      declaration.forceInclude = true;
    }
    this.registerDeclaration(declaration, filePath);
  }

  private static isTypeOnlyDeclaration(node: ts.Node): boolean {
    return ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node);
  }
}
