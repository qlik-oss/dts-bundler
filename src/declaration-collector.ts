import ts from "typescript";
import {
  getDeclarationName,
  hasDefaultModifier,
  hasExportModifier,
  isDeclaration,
  isDeclareGlobal,
} from "./declaration-utils";
import type { FileCollector } from "./file-collector";
import { collectBindingElementsFromDeclarations } from "./helpers/binding-identifiers";
import type { TypeRegistry } from "./registry";
import { ExportKind, TypeDeclaration, type ExportInfo } from "./types";

export class DeclarationCollector {
  private registry: TypeRegistry;
  private fileCollector: FileCollector;
  private options: { inlineDeclareGlobals: boolean; inlineDeclareExternals: boolean };
  private defaultExportCounter = 0;

  /**
   * Create a new `DeclarationCollector`.
   *
   * @param registry - Shared type registry to register discovered declarations.
   * @param fileCollector - Helper to query file/module resolution and inlining rules.
   * @param options - Controls whether `declare global` and external `declare module` blocks are inlined.
   */
  constructor(
    registry: TypeRegistry,
    fileCollector: FileCollector,
    options: { inlineDeclareGlobals: boolean; inlineDeclareExternals: boolean },
  ) {
    this.registry = registry;
    this.fileCollector = fileCollector;
    this.options = options;
  }

  /**
   * Register a `TypeDeclaration` with the `TypeRegistry`, marking whether
   * it originates from an inlined library.
   *
   * @param declaration - The declaration information to register.
   * @param filePath - The source file path where the declaration was found.
   */
  private registerDeclaration(declaration: TypeDeclaration, filePath: string): void {
    // eslint-disable-next-line no-param-reassign
    declaration.isFromInlinedLibrary = this.fileCollector.isFromInlinedLibrary(filePath);
    this.registry.register(declaration);
  }

  /**
   * Walk the top-level statements of a `SourceFile` and collect declarations.
   * This will handle export assignments, ambient modules, module augmentations
   * and other declaration forms. When a default export name is discovered for
   * an entry file, `onDefaultExportName` will be invoked.
   *
   * @param filePath - Path of the file being processed.
   * @param sourceFile - The parsed `SourceFile` AST.
   * @param isEntry - Whether this file is the entry point for the bundle.
   * @param onDefaultExportName - Callback invoked when a default export name is determined.
   */
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

  /**
   * Handle `declare module "x" { ... }` blocks. Decide whether the module
   * should be inlined into the bundle or treated as an external declaration
   * depending on `fileCollector` resolution and the inlining options.
   */
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

  /**
   * Parse a non-module top-level declaration (classes, interfaces, functions,
   * type aliases, exported vars, etc.) and register it in the `TypeRegistry`.
   */
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

  /**
   * Handle `export default` expressions like `export default <expr>` where the
   * expression is not a simple identifier. A synthetic variable declaration is
   * created and registered as the default export.
   */
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

  /**
   * If a class/function is exported as a default with no name, create a
   * synthetic named declaration so it can be referenced by name in the bundle.
   */
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

  /**
   * Create a const variable statement representing the default export value.
   * Used to convert `export default <expr>` into a named `const _default = <expr>`.
   */
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

  /**
   * Generate a synthetic name for anonymous default exports. Names are stable
   * within a run and take the form `_default`, `_default$1`, `_default$2`, ...
   */
  private getSyntheticDefaultExportName(): string {
    const current = this.defaultExportCounter;
    this.defaultExportCounter += 1;
    if (current === 0) {
      return "_default";
    }
    return `_default$${current}`;
  }

  /**
   * Remove `default` and `export` modifiers from a declaration's modifier list.
   * Returns `undefined` when no modifiers remain.
   */
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

  /**
   * Parse a `var/let/const` statement. Handles both simple identifiers and
   * binding patterns by producing `TypeDeclaration` entries for each declared name.
   */
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

  /**
   * Handle module augmentations like `declare module X { ... }` where the module
   * name is an identifier (augmentation of an existing namespace). These are
   * collected as declarations and may be forced-included when `declare global`.
   */
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

  /**
   * Return true when the given node represents a "type-only" declaration
   * (interfaces and type aliases) which do not generate value-level output.
   */
  private static isTypeOnlyDeclaration(node: ts.Node): boolean {
    return ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node);
  }
}
