import ts from "typescript";
import { FileCollector } from "./file-collector.js";
import type { TypeRegistry } from "./registry.js";
import type { ImportInfo } from "./types.js";
import { TypeDeclaration } from "./types.js";

export class DeclarationParser {
  public importMap: Map<string, Map<string, ImportInfo>>;
  private registry: TypeRegistry;
  private fileCollector: FileCollector;

  constructor(registry: TypeRegistry, fileCollector: FileCollector) {
    this.registry = registry;
    this.fileCollector = fileCollector;
    this.importMap = new Map();
  }

  parseFiles(files: Map<string, { sourceFile: ts.SourceFile; isEntry: boolean }>): void {
    for (const [filePath, { sourceFile, isEntry }] of files.entries()) {
      this.parseFile(filePath, sourceFile, isEntry);
    }
  }

  private parseFile(filePath: string, sourceFile: ts.SourceFile, isEntry: boolean): void {
    const fileImports = new Map<string, ImportInfo>();
    this.importMap.set(filePath, fileImports);

    for (const statement of sourceFile.statements) {
      if (ts.isImportDeclaration(statement)) {
        this.parseImport(statement, filePath, fileImports);
      }
    }

    for (const statement of sourceFile.statements) {
      if (DeclarationParser.isDeclaration(statement)) {
        this.parseDeclaration(statement, filePath, sourceFile, isEntry);
      }
    }
  }

  private parseImport(statement: ts.ImportDeclaration, filePath: string, fileImports: Map<string, ImportInfo>): void {
    const moduleSpecifier = statement.moduleSpecifier;
    if (!ts.isStringLiteral(moduleSpecifier)) {
      return;
    }

    const importPath = moduleSpecifier.text;
    const isTypeOnly = statement.importClause?.isTypeOnly ?? false;

    if (this.fileCollector.shouldInline(importPath)) {
      const resolvedPath = FileCollector.resolveImport(filePath, importPath);

      const importClause = statement.importClause;
      if (importClause?.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
        for (const element of importClause.namedBindings.elements) {
          const localName = element.name.text;
          const originalName = element.propertyName?.text || localName;
          fileImports.set(localName, {
            originalName,
            sourceFile: resolvedPath,
            isExternal: false,
            aliasName: localName !== originalName ? localName : null,
          });
        }
      }
    } else {
      const importClause = statement.importClause;
      if (importClause?.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
        for (const element of importClause.namedBindings.elements) {
          const localName = element.name.text;
          const originalName = element.propertyName?.text || localName;
          const importStr = originalName === localName ? localName : `${originalName} as ${localName}`;

          this.registry.registerExternal(importPath, importStr, isTypeOnly);
          fileImports.set(localName, {
            originalName: importStr,
            sourceFile: importPath,
            isExternal: true,
          });
        }
      }

      if (importClause?.namedBindings && ts.isNamespaceImport(importClause.namedBindings)) {
        const localName = importClause.namedBindings.name.text;
        const importStr = `* as ${localName}`;
        this.registry.registerExternal(importPath, importStr, isTypeOnly);
        fileImports.set(localName, {
          originalName: importStr,
          sourceFile: importPath,
          isExternal: true,
        });
      }

      if (importClause?.name) {
        const localName = importClause.name.text;
        const importStr = `default as ${localName}`;
        this.registry.registerExternal(importPath, importStr, isTypeOnly);
        fileImports.set(localName, {
          originalName: importStr,
          sourceFile: importPath,
          isExternal: true,
        });
      }
    }
  }

  private static isDeclaration(statement: ts.Statement): boolean {
    return (
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isEnumDeclaration(statement) ||
      ts.isModuleDeclaration(statement)
    );
  }

  private parseDeclaration(
    statement: ts.Statement,
    filePath: string,
    sourceFile: ts.SourceFile,
    isEntry: boolean,
  ): void {
    const name = DeclarationParser.getDeclarationName(statement);
    if (!name) return;

    const hasExport = DeclarationParser.hasExportModifier(statement);
    const isExported = isEntry ? hasExport : false;

    const declaration = new TypeDeclaration(name, filePath, statement, sourceFile, isExported);

    this.registry.register(declaration);
  }

  private static getDeclarationName(statement: ts.Statement): string | null {
    if (
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isEnumDeclaration(statement) ||
      ts.isModuleDeclaration(statement)
    ) {
      return statement.name?.text ?? null;
    }
    return null;
  }

  private static hasExportModifier(statement: ts.Statement): boolean {
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    return modifiers?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword) ?? false;
  }
}
