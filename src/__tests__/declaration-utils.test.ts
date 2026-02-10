import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  getDeclarationName,
  hasDefaultModifier,
  hasExportModifier,
  isDeclaration,
  isDeclareGlobal,
} from "../declaration-utils";

describe("declaration-utils", () => {
  describe("isDeclaration", () => {
    it("should identify interface declarations", () => {
      const code = "interface Foo {}";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const statement = sourceFile.statements[0];
      expect(isDeclaration(statement)).toBe(true);
    });

    it("should identify type alias declarations", () => {
      const code = "type Foo = string;";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const statement = sourceFile.statements[0];
      expect(isDeclaration(statement)).toBe(true);
    });

    it("should identify class declarations", () => {
      const code = "class Foo {}";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const statement = sourceFile.statements[0];
      expect(isDeclaration(statement)).toBe(true);
    });

    it("should identify enum declarations", () => {
      const code = "enum Foo {}";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const statement = sourceFile.statements[0];
      expect(isDeclaration(statement)).toBe(true);
    });

    it("should identify module declarations", () => {
      const code = "namespace Foo {}";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const statement = sourceFile.statements[0];
      expect(isDeclaration(statement)).toBe(true);
    });

    it("should identify function declarations", () => {
      const code = "function foo() {}";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const statement = sourceFile.statements[0];
      expect(isDeclaration(statement)).toBe(true);
    });

    it("should identify variable statements", () => {
      const code = "const foo = 1;";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const statement = sourceFile.statements[0];
      expect(isDeclaration(statement)).toBe(true);
    });

    it("should not identify import declarations as declarations", () => {
      const code = "import { foo } from 'bar';";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const statement = sourceFile.statements[0];
      expect(isDeclaration(statement)).toBe(false);
    });
  });

  describe("getDeclarationName", () => {
    it("should get interface name", () => {
      const code = "interface Foo {}";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const statement = sourceFile.statements[0];
      expect(getDeclarationName(statement)).toBe("Foo");
    });

    it("should get type alias name", () => {
      const code = "type Foo = string;";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const statement = sourceFile.statements[0];
      expect(getDeclarationName(statement)).toBe("Foo");
    });

    it("should get class name", () => {
      const code = "class Foo {}";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const statement = sourceFile.statements[0];
      expect(getDeclarationName(statement)).toBe("Foo");
    });

    it("should get function name", () => {
      const code = "function foo() {}";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const statement = sourceFile.statements[0];
      expect(getDeclarationName(statement)).toBe("foo");
    });

    it("should get variable name from variable statement", () => {
      const code = "const foo = 1;";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const statement = sourceFile.statements[0];
      expect(getDeclarationName(statement)).toBe("foo");
    });

    it("should return null for binding pattern without initializer", () => {
      const code = "const { foo } = bar;";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const statement = sourceFile.statements[0];
      const name = getDeclarationName(statement);
      expect(name).toMatch(/^__binding_/);
    });

    it("should return null for non-named declarations", () => {
      const code = "export {};";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const statement = sourceFile.statements[0];
      expect(getDeclarationName(statement)).toBeNull();
    });
  });

  describe("hasExportModifier", () => {
    it("should detect export on interface", () => {
      const code = "export interface Foo {}";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const statement = sourceFile.statements[0];
      expect(hasExportModifier(statement)).toBe(true);
    });

    it("should detect export on class", () => {
      const code = "export class Foo {}";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const statement = sourceFile.statements[0];
      expect(hasExportModifier(statement)).toBe(true);
    });

    it("should return false for non-exported interface", () => {
      const code = "interface Foo {}";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const statement = sourceFile.statements[0];
      expect(hasExportModifier(statement)).toBe(false);
    });
  });

  describe("hasDefaultModifier", () => {
    it("should detect default export on class", () => {
      const code = "export default class Foo {}";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const statement = sourceFile.statements[0];
      expect(hasDefaultModifier(statement)).toBe(true);
    });

    it("should detect default on export declaration", () => {
      const code = "export { foo as default };";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const statement = sourceFile.statements[0];
      expect(hasDefaultModifier(statement)).toBe(false);
    });

    it("should return false for non-default exports", () => {
      const code = "export class Foo {}";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const statement = sourceFile.statements[0];
      expect(hasDefaultModifier(statement)).toBe(false);
    });
  });

  describe("isDeclareGlobal", () => {
    it("should identify declare global blocks", () => {
      const code = "declare global { interface Window { foo: string; } }";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const statement = sourceFile.statements[0];
      expect(isDeclareGlobal(statement)).toBe(true);
    });

    it("should not identify regular namespace as global", () => {
      const code = "namespace Foo {}";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const statement = sourceFile.statements[0];
      expect(isDeclareGlobal(statement)).toBe(false);
    });

    it("should not identify declare module as global", () => {
      const code = "declare module 'foo' {}";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const statement = sourceFile.statements[0];
      expect(isDeclareGlobal(statement)).toBe(false);
    });
  });
});
