import ts from "typescript";
import {
  getDeclarationName,
  hasDefaultModifier,
  hasExportModifier,
  isDeclaration,
  isDeclareGlobal,
} from "./declaration-utils.js";
import type { FileCollector } from "./file-collector.js";
import type { TypeRegistry } from "./registry.js";
import { ExportKind, TypeDeclaration, type ExportInfo } from "./types.js";

export class DeclarationCollector {
  private registry: TypeRegistry;
  private fileCollector: FileCollector;
  private options: { inlineDeclareGlobals: boolean; inlineDeclareExternals: boolean };

  constructor(
    registry: TypeRegistry,
    fileCollector: FileCollector,
    options: { inlineDeclareGlobals: boolean; inlineDeclareExternals: boolean },
  ) {
    this.registry = registry;
    this.fileCollector = fileCollector;
    this.options = options;
  }

  collectDeclarations(
    filePath: string,
    sourceFile: ts.SourceFile,
    isEntry: boolean,
    onDefaultExportName: (name: string) => void,
  ): void {
    for (const statement of sourceFile.statements) {
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
    const resolvedModule = this.fileCollector.resolveModuleSpecifier(filePath, moduleName);
    const shouldInline =
      this.fileCollector.shouldInline(moduleName) ||
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
      this.registry.register(declaration);
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
      declaration.forceInclude = true;
      this.registry.register(declaration);
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
    if (!name) return;

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

    if (isEntry && hasDefaultExport) {
      exportInfo.kind = ExportKind.Default;
      onDefaultExportName(name);
    }

    const declaration = new TypeDeclaration(name, filePath, statement, sourceFile, exportInfo);
    this.registry.register(declaration);
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
      const identifiers = DeclarationCollector.collectBindingIdentifiers(declarations);
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
        const synthetic = ts.factory.createVariableDeclaration(identifier, undefined, undefined, element.initializer);
        ts.setTextRange(synthetic, element);
        declaration.variableDeclaration = synthetic;
        this.registry.register(declaration);
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
      declaration.variableDeclaration = varDecl;
      this.registry.register(declaration);
    }
  }

  private static collectBindingIdentifiers(
    declarations: ts.NodeArray<ts.VariableDeclaration>,
  ): Array<{ identifier: ts.Identifier; element: ts.BindingElement }> {
    const identifiers: Array<{ identifier: ts.Identifier; element: ts.BindingElement }> = [];

    const visitBindingElement = (element: ts.BindingElement): void => {
      if (ts.isIdentifier(element.name)) {
        identifiers.push({ identifier: element.name, element });
        return;
      }

      if (ts.isObjectBindingPattern(element.name)) {
        for (const child of element.name.elements) {
          visitBindingElement(child);
        }
        return;
      }

      if (ts.isArrayBindingPattern(element.name)) {
        for (const child of element.name.elements) {
          if (ts.isOmittedExpression(child)) {
            continue;
          }
          visitBindingElement(child);
        }
      }
    };

    for (const decl of declarations) {
      if (ts.isIdentifier(decl.name)) {
        continue;
      }

      if (ts.isObjectBindingPattern(decl.name)) {
        for (const element of decl.name.elements) {
          visitBindingElement(element);
        }
      } else if (ts.isArrayBindingPattern(decl.name)) {
        for (const element of decl.name.elements) {
          if (ts.isOmittedExpression(element)) {
            continue;
          }
          visitBindingElement(element);
        }
      }
    }

    return identifiers;
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
    this.registry.register(declaration);
  }
}
