import ts from "typescript";
import { beforeEach, describe, expect, it } from "vitest";
import { AstPrinter } from "../ast-printer";

describe("AstPrinter", () => {
  let printer: AstPrinter;

  beforeEach(() => {
    printer = new AstPrinter();
  });

  describe("printNode", () => {
    it("should print a simple interface declaration", () => {
      const code = "interface Foo { bar: string; }";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const node = sourceFile.statements[0];

      const result = printer.printNode(node, sourceFile);
      expect(result).toContain("interface Foo");
      expect(result).toContain("bar: string");
    });

    it("should print a type alias", () => {
      const code = "type Foo = string | number;";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const node = sourceFile.statements[0];

      const result = printer.printNode(node, sourceFile);
      expect(result).toContain("type Foo");
      expect(result).toContain("string | number");
    });

    it("should print a class declaration", () => {
      const code = "class Foo { prop: string; }";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const node = sourceFile.statements[0];

      const result = printer.printNode(node, sourceFile);
      expect(result).toContain("class Foo");
      expect(result).toContain("prop: string");
    });

    it("should print a function declaration", () => {
      const code = "function foo(x: number): string { return 'test'; }";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const node = sourceFile.statements[0];

      const result = printer.printNode(node, sourceFile);
      expect(result).toContain("function foo");
      expect(result).toContain("x: number");
    });

    it("should handle rename map option", () => {
      const code = "interface Foo { bar: Baz; }";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const node = sourceFile.statements[0];

      const renameMap = new Map([["Baz", "QuxType"]]);
      const result = printer.printNode(node, sourceFile, { renameMap });
      expect(result).toContain("interface Foo");
    });

    it("should preserve comments when printing", () => {
      const code = "/** JSDoc comment */\ninterface Foo {}";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const node = sourceFile.statements[0];

      const result = printer.printNode(node, sourceFile);
      expect(result).toContain("interface Foo");
    });

    it("should print enum declaration", () => {
      const code = "enum Foo { Bar = 1, Baz = 2 }";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const node = sourceFile.statements[0];

      const result = printer.printNode(node, sourceFile);
      expect(result).toContain("enum Foo");
      expect(result).toContain("Bar");
      expect(result).toContain("Baz");
    });

    it("should print module declaration", () => {
      const code = "namespace Bar { export interface Foo {} }";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const node = sourceFile.statements[0];

      const result = printer.printNode(node, sourceFile);
      expect(result).toContain("namespace Bar");
      expect(result).toContain("interface Foo");
    });
  });

  describe("printStatement", () => {
    it("should print a statement", () => {
      const code = "export interface Foo { bar: string; }";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const statement = sourceFile.statements[0];

      const result = printer.printStatement(statement, sourceFile);
      expect(result).toContain("export");
      expect(result).toContain("interface Foo");
    });

    it("should print export statement", () => {
      const code = "export { Foo };";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const statement = sourceFile.statements[0];

      const result = printer.printStatement(statement, sourceFile);
      expect(result).toContain("export");
      expect(result).toContain("Foo");
    });

    it("should handle export with renaming", () => {
      const code = "export { Foo as Bar };";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const statement = sourceFile.statements[0];

      const result = printer.printStatement(statement, sourceFile);
      expect(result).toContain("Foo");
      expect(result).toContain("Bar");
    });

    it("should print variable statement", () => {
      const code = "declare const foo: string;";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const statement = sourceFile.statements[0];

      const result = printer.printStatement(statement, sourceFile);
      expect(result).toContain("declare");
      expect(result).toContain("const foo");
      expect(result).toContain("string");
    });

    it("should apply rename transformations to printed output", () => {
      const code = "interface Foo { bar: Baz; }";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const statement = sourceFile.statements[0];

      const renameMap = new Map([["Baz", "RenamedBaz"]]);
      const result = printer.printStatement(statement, sourceFile, { renameMap });
      expect(result).toContain("Foo");
    });
  });

  describe("printNode with transformations", () => {
    it("should handle qualified names with qualifiedNameMap", () => {
      const code = "type Foo = A.B.C;";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const node = sourceFile.statements[0];

      const qualifiedNameMap = new Map([["A.B.C", "SimpleName"]]);
      const result = printer.printNode(node, sourceFile, { qualifiedNameMap });
      expect(result).toContain("type Foo");
    });

    it("should remove import type nodes when stripImportType is true", () => {
      const code = "type Foo = import('bar').SomeType;";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const node = sourceFile.statements[0];

      const stripImportType = () => true;
      const result = printer.printNode(node, sourceFile, { stripImportType });
      expect(result).toContain("type Foo");
    });

    it("should preserve global references when specified", () => {
      const code = "interface Foo extends Window {}";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const node = sourceFile.statements[0];

      const result = printer.printNode(node, sourceFile, { preserveGlobalReferences: true });
      expect(result).toContain("interface Foo");
    });

    it("should use namespace import names when provided", () => {
      const code = "type Foo = ns.Bar;";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const node = sourceFile.statements[0];

      const namespaceImportNames = new Set(["ns"]);
      const result = printer.printNode(node, sourceFile, { namespaceImportNames });
      expect(result).toContain("type Foo");
    });
  });

  describe("complex node printing", () => {
    it("should print interface with generic", () => {
      const code = "interface Foo<T> { value: T; }";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const node = sourceFile.statements[0];

      const result = printer.printNode(node, sourceFile);
      expect(result).toContain("interface Foo");
      expect(result).toContain("T");
    });

    it("should print union types", () => {
      const code = "type Foo = string | number | boolean;";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const node = sourceFile.statements[0];

      const result = printer.printNode(node, sourceFile);
      expect(result).toContain("string | number | boolean");
    });

    it("should print intersection types", () => {
      const code = "type Foo = A & B & C;";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const node = sourceFile.statements[0];

      const result = printer.printNode(node, sourceFile);
      expect(result).toContain("A & B & C");
    });

    it("should print conditional types", () => {
      const code = "type Foo<T> = T extends string ? true : false;";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const node = sourceFile.statements[0];

      const result = printer.printNode(node, sourceFile);
      expect(result).toContain("extends string");
    });

    it("should print mapped types", () => {
      const code = "type Foo<T> = { [K in keyof T]: T[K]; };";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const node = sourceFile.statements[0];

      const result = printer.printNode(node, sourceFile);
      expect(result).toContain("keyof");
    });
  });
});
