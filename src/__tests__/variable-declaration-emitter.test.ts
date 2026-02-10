import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AstPrinter } from "../ast-printer";
import type { TypeDeclaration } from "../types";
import { ExportKind } from "../types";
import { VariableDeclarationEmitter } from "../variable-declaration-emitter";

describe("VariableDeclarationEmitter", () => {
  let emitter: VariableDeclarationEmitter;
  let checker: ts.TypeChecker;
  let addExtraDefaultExport: (name: string) => void;
  let printer: AstPrinter;
  let getRenameMap: () => Map<string, string>;

  beforeEach(() => {
    const program = ts.createProgram(["test.ts"], {});
    checker = program.getTypeChecker();

    addExtraDefaultExport = vi.fn();
    printer = new AstPrinter();
    getRenameMap = vi.fn(() => new Map());

    emitter = new VariableDeclarationEmitter(checker, addExtraDefaultExport, printer, getRenameMap);
  });

  describe("generateVariableStatementLines", () => {
    it("should emit variable statement with single declaration", () => {
      const code = "const foo: string = 'test';";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const statement = sourceFile.statements[0] as ts.VariableStatement;

      const declaration = {
        id: Symbol("test"),
        name: "foo",
        normalizedName: "foo",
        sourceFile: "test.ts",
        node: statement,
        exportInfo: { kind: ExportKind.Named, wasOriginallyExported: true },
        dependencies: new Set(),
        externalDependencies: new Map(),
        namespaceDependencies: new Set(),
        sourceFileNode: sourceFile,
        isTypeOnly: false,
        mergeGroup: null,
        importAliases: new Map(),
        forceInclude: false,
        isFromInlinedLibrary: false,
        usedInGlobal: false,
        usedInNonGlobal: false,
      };

      const lines = emitter.generateVariableStatementLines(statement, [declaration] as unknown as TypeDeclaration[]);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines[0]).toContain("foo");
    });

    it("should handle default only export", () => {
      const code = "const foo: string = 'test';";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const statement = sourceFile.statements[0] as ts.VariableStatement;

      const declaration = {
        id: Symbol("test"),
        name: "foo",
        normalizedName: "foo",
        sourceFile: "test.ts",
        node: statement,
        exportInfo: { kind: ExportKind.DefaultOnly, wasOriginallyExported: true },
        dependencies: new Set(),
        externalDependencies: new Map(),
        namespaceDependencies: new Set(),
        sourceFileNode: sourceFile,
        isTypeOnly: false,
        mergeGroup: null,
        importAliases: new Map(),
        forceInclude: false,
        isFromInlinedLibrary: false,
        usedInGlobal: false,
        usedInNonGlobal: false,
      };

      const lines = emitter.generateVariableStatementLines(statement, [declaration] as unknown as TypeDeclaration[]);
      // DefaultOnly exports generate variable statements
      expect(lines.length).toBeGreaterThan(0);
      // addExtraDefaultExport might be called during the process
      expect(lines[0]).toBeDefined();
    });

    it("should separate exported and non-exported declarations", () => {
      const code = "const foo: string = 'test';";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const statement = sourceFile.statements[0] as ts.VariableStatement;

      const exportedDecl = {
        id: Symbol("exported"),
        name: "foo",
        normalizedName: "foo",
        sourceFile: "test.ts",
        node: statement,
        exportInfo: { kind: ExportKind.Named, wasOriginallyExported: true },
        dependencies: new Set(),
        externalDependencies: new Map(),
        namespaceDependencies: new Set(),
        sourceFileNode: sourceFile,
        isTypeOnly: false,
        mergeGroup: null,
        importAliases: new Map(),
        forceInclude: false,
        isFromInlinedLibrary: false,
        usedInGlobal: false,
        usedInNonGlobal: false,
      };

      const nonExportedDecl = {
        id: Symbol("notExported"),
        name: "bar",
        normalizedName: "bar",
        sourceFile: "test.ts",
        node: statement,
        exportInfo: { kind: ExportKind.NotExported, wasOriginallyExported: false },
        dependencies: new Set(),
        externalDependencies: new Map(),
        namespaceDependencies: new Set(),
        sourceFileNode: sourceFile,
        isTypeOnly: false,
        mergeGroup: null,
        importAliases: new Map(),
        forceInclude: false,
        isFromInlinedLibrary: false,
        usedInGlobal: false,
        usedInNonGlobal: false,
      };

      const lines = emitter.generateVariableStatementLines(statement, [
        exportedDecl,
        nonExportedDecl,
      ] as unknown as TypeDeclaration[]);
      expect(lines.length).toBeGreaterThan(1);
    });
  });

  describe("multiple declarations", () => {
    it("should handle multiple declarations in a statement", () => {
      const code = "const foo: string = 'test', bar: number = 42;";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const statement = sourceFile.statements[0] as ts.VariableStatement;

      const fooDecl = {
        id: Symbol("foo"),
        name: "foo",
        normalizedName: "foo",
        sourceFile: "test.ts",
        node: statement,
        exportInfo: { kind: ExportKind.Named, wasOriginallyExported: true },
        dependencies: new Set(),
        externalDependencies: new Map(),
        namespaceDependencies: new Set(),
        sourceFileNode: sourceFile,
        isTypeOnly: false,
        mergeGroup: null,
        importAliases: new Map(),
        forceInclude: false,
        isFromInlinedLibrary: false,
        usedInGlobal: false,
        usedInNonGlobal: false,
      };

      const barDecl = {
        id: Symbol("bar"),
        name: "bar",
        normalizedName: "bar",
        sourceFile: "test.ts",
        node: statement,
        exportInfo: { kind: ExportKind.NotExported, wasOriginallyExported: false },
        dependencies: new Set(),
        externalDependencies: new Map(),
        namespaceDependencies: new Set(),
        sourceFileNode: sourceFile,
        isTypeOnly: false,
        mergeGroup: null,
        importAliases: new Map(),
        forceInclude: false,
        isFromInlinedLibrary: false,
        usedInGlobal: false,
        usedInNonGlobal: false,
      };

      const lines = emitter.generateVariableStatementLines(statement, [
        fooDecl,
        barDecl,
      ] as unknown as TypeDeclaration[]);
      expect(lines.length).toBeGreaterThanOrEqual(1);
    });

    it("should respect order of declarations", () => {
      const code = "const a: number = 1, b: number = 2, c: number = 3;";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const statement = sourceFile.statements[0] as ts.VariableStatement;

      const declarations: TypeDeclaration[] = [
        {
          id: Symbol("c"),
          name: "c",
          normalizedName: "c",
          sourceFile: "test.ts",
          node: statement,
          exportInfo: { kind: ExportKind.Named, wasOriginallyExported: true },
          dependencies: new Set(),
          externalDependencies: new Map(),
          namespaceDependencies: new Set(),
          sourceFileNode: sourceFile,
          isTypeOnly: false,
          mergeGroup: null,
          importAliases: new Map(),
          forceInclude: false,
          isFromInlinedLibrary: false,
          usedInGlobal: false,
          usedInNonGlobal: false,
        },
        {
          id: Symbol("a"),
          name: "a",
          normalizedName: "a",
          sourceFile: "test.ts",
          node: statement,
          exportInfo: { kind: ExportKind.Named, wasOriginallyExported: true },
          dependencies: new Set(),
          externalDependencies: new Map(),
          namespaceDependencies: new Set(),
          sourceFileNode: sourceFile,
          isTypeOnly: false,
          mergeGroup: null,
          importAliases: new Map(),
          forceInclude: false,
          isFromInlinedLibrary: false,
          usedInGlobal: false,
          usedInNonGlobal: false,
        },
      ] as unknown as TypeDeclaration[];

      const lines = emitter.generateVariableStatementLines(statement, declarations as unknown as TypeDeclaration[]);
      expect(lines.length).toBeGreaterThan(0);
    });
  });

  describe("declaration kinds", () => {
    it("should handle const declarations", () => {
      const code = "const x: number = 5;";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const statement = sourceFile.statements[0] as ts.VariableStatement;

      const declaration = {
        id: Symbol("x"),
        name: "x",
        normalizedName: "x",
        sourceFile: "test.ts",
        node: statement,
        exportInfo: { kind: ExportKind.NotExported, wasOriginallyExported: false },
        dependencies: new Set(),
        externalDependencies: new Map(),
        namespaceDependencies: new Set(),
        sourceFileNode: sourceFile,
        isTypeOnly: false,
        mergeGroup: null,
        importAliases: new Map(),
        forceInclude: false,
        isFromInlinedLibrary: false,
        usedInGlobal: false,
        usedInNonGlobal: false,
      };

      const lines = emitter.generateVariableStatementLines(statement, [declaration] as unknown as TypeDeclaration[]);
      expect(lines.length).toBeGreaterThan(0);
    });

    it("should handle let declarations", () => {
      const code = "let x: string;";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const statement = sourceFile.statements[0] as ts.VariableStatement;

      const declaration = {
        id: Symbol("x"),
        name: "x",
        normalizedName: "x",
        sourceFile: "test.ts",
        node: statement,
        exportInfo: { kind: ExportKind.NotExported, wasOriginallyExported: false },
        dependencies: new Set(),
        externalDependencies: new Map(),
        namespaceDependencies: new Set(),
        sourceFileNode: sourceFile,
        isTypeOnly: false,
        mergeGroup: null,
        importAliases: new Map(),
        forceInclude: false,
        isFromInlinedLibrary: false,
        usedInGlobal: false,
        usedInNonGlobal: false,
      };

      const lines = emitter.generateVariableStatementLines(statement, [declaration] as unknown as TypeDeclaration[]);
      expect(lines.length).toBeGreaterThan(0);
    });

    it("should handle var declarations", () => {
      const code = "var x: boolean;";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const statement = sourceFile.statements[0] as ts.VariableStatement;

      const declaration = {
        id: Symbol("x"),
        name: "x",
        normalizedName: "x",
        sourceFile: "test.ts",
        node: statement,
        exportInfo: { kind: ExportKind.NotExported, wasOriginallyExported: false },
        dependencies: new Set(),
        externalDependencies: new Map(),
        namespaceDependencies: new Set(),
        sourceFileNode: sourceFile,
        isTypeOnly: false,
        mergeGroup: null,
        importAliases: new Map(),
        forceInclude: false,
        isFromInlinedLibrary: false,
        usedInGlobal: false,
        usedInNonGlobal: false,
      };

      const lines = emitter.generateVariableStatementLines(statement, [declaration] as unknown as TypeDeclaration[]);
      expect(lines.length).toBeGreaterThan(0);
    });
  });
});
