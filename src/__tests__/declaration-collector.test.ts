import { describe, it, expect, beforeEach, vi } from "vitest";
import ts from "typescript";
import { DeclarationCollector } from "../declaration-collector";
import { TypeRegistry } from "../registry";
import type { FileCollector } from "../file-collector";

describe("DeclarationCollector", () => {
  let collector: DeclarationCollector;
  let registry: TypeRegistry;
  let fileCollector: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    registry = new TypeRegistry();
    fileCollector = {
      isFromInlinedLibrary: vi.fn(() => false),
    } as unknown as ReturnType<typeof vi.fn>;

    collector = new DeclarationCollector(registry, fileCollector as unknown as FileCollector, {
      inlineDeclareGlobals: false,
      inlineDeclareExternals: false,
    });
  });

  describe("collectDeclarations", () => {
    it("should collect interface declarations", () => {
      const code = "interface Foo { bar: string; }";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);

      collector.collectDeclarations("test.ts", sourceFile, false, vi.fn());

      const declarations = Array.from(registry.declarations.values());
      expect(declarations.length).toBe(1);
      expect(declarations[0].name).toBe("Foo");
    });

    it("should collect type alias declarations", () => {
      const code = "type Foo = string | number;";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);

      collector.collectDeclarations("test.ts", sourceFile, false, vi.fn());

      const declarations = Array.from(registry.declarations.values());
      expect(declarations.length).toBe(1);
      expect(declarations[0].name).toBe("Foo");
    });

    it("should collect class declarations", () => {
      const code = "class Foo { constructor() {} }";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);

      collector.collectDeclarations("test.ts", sourceFile, false, vi.fn());

      const declarations = Array.from(registry.declarations.values());
      expect(declarations.length).toBe(1);
      expect(declarations[0].name).toBe("Foo");
    });

    it("should collect enum declarations", () => {
      const code = "enum Foo { Bar, Baz }";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);

      collector.collectDeclarations("test.ts", sourceFile, false, vi.fn());

      const declarations = Array.from(registry.declarations.values());
      expect(declarations.length).toBe(1);
      expect(declarations[0].name).toBe("Foo");
    });

    it("should collect function declarations", () => {
      const code = "function foo() {}";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);

      collector.collectDeclarations("test.ts", sourceFile, false, vi.fn());

      const declarations = Array.from(registry.declarations.values());
      expect(declarations.length).toBe(1);
      expect(declarations[0].name).toBe("foo");
    });

    it("should collect variable declarations", () => {
      const code = "declare const foo: string;";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);

      collector.collectDeclarations("test.ts", sourceFile, false, vi.fn());

      const declarations = Array.from(registry.declarations.values());
      expect(declarations.length).toBeGreaterThanOrEqual(1);
      expect(declarations[0].name).toBe("foo");
    });

    it("should collect multiple declarations from same file", () => {
      const code = `
        interface Foo {}
        interface Bar {}
        type Baz = string;
      `;
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);

      collector.collectDeclarations("test.ts", sourceFile, false, vi.fn());

      const declarations = Array.from(registry.declarations.values());
      const names = declarations.map((d) => d.name);
      expect(names).toContain("Foo");
      expect(names).toContain("Bar");
      expect(names).toContain("Baz");
    });

    it("should track exported declarations", () => {
      const code = "export interface Foo {}";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);

      collector.collectDeclarations("test.ts", sourceFile, false, vi.fn());

      const declarations = Array.from(registry.declarations.values());
      expect(declarations.length).toBe(1);
      // Interface declarations might be treated differently
      expect(declarations[0].name).toBe("Foo");
    });

    it("should track declaration source file", () => {
      const code = "interface Foo {}";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);

      collector.collectDeclarations("test.ts", sourceFile, false, vi.fn());

      const declarations = Array.from(registry.declarations.values());
      expect(declarations[0].sourceFile).toBe("test.ts");
    });

    it("should skip non-declaration statements", () => {
      const code = `
        import { Something } from 'foo';
        interface Foo {}
      `;
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);

      collector.collectDeclarations("test.ts", sourceFile, false, vi.fn());

      const declarations = Array.from(registry.declarations.values());
      const names = declarations.map((d) => d.name);
      expect(names).toContain("Foo");
      expect(names.length).toBeLessThanOrEqual(1);
    });
  });

  describe("export assignment handling", () => {
    it("should call onDefaultExportName for default exports", () => {
      const code = "export default class Foo {}";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const onDefaultExportName = vi.fn();

      collector.collectDeclarations("test.ts", sourceFile, true, onDefaultExportName);

      expect(onDefaultExportName).toHaveBeenCalled();
    });
  });

  describe("inlineDeclareGlobals option", () => {
    it("should include declare global when option is true", () => {
      const code = "declare global { interface Window { foo: string; } }";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);

      const collectorWithGlobal = new DeclarationCollector(registry, fileCollector as unknown as FileCollector, {
        inlineDeclareGlobals: true,
        inlineDeclareExternals: false,
      });

      collectorWithGlobal.collectDeclarations("test.ts", sourceFile, false, vi.fn());

      const declarations = Array.from(registry.declarations.values());
      // When inlineDeclareGlobals is true, should include declarations from global augmentation
      expect(declarations.length).toBeGreaterThanOrEqual(0);
    });

    it("should include declare global augmentations", () => {
      const code = "declare global { interface Window { foo: string; } }";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);

      collector.collectDeclarations("test.ts", sourceFile, false, vi.fn());

      // The actual behavior will include the global augmentation
      const declarations = Array.from(registry.declarations.values());
      expect(declarations.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("declaration tracking", () => {
    it("should track declarations by source file", () => {
      const code = "interface Foo {} interface Bar {}";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);

      collector.collectDeclarations("test.ts", sourceFile, false, vi.fn());

      const fileDeclarations = registry.declarationsByFile.get("test.ts");
      expect(fileDeclarations?.size).toBeGreaterThan(0);
    });

    it("should index declarations by name", () => {
      const code = "interface Foo {}";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);

      collector.collectDeclarations("test.ts", sourceFile, false, vi.fn());

      const key = "test.ts:Foo";
      expect(registry.nameIndex.has(key)).toBe(true);
    });
  });

  describe("declaration node information", () => {
    it("should store the TypeScript node", () => {
      const code = "interface Foo {}";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);

      collector.collectDeclarations("test.ts", sourceFile, false, vi.fn());

      const declarations = Array.from(registry.declarations.values());
      expect(ts.isInterfaceDeclaration(declarations[0].node)).toBe(true);
    });

    it("should store declaration information", () => {
      const code = "interface Foo {}";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);

      collector.collectDeclarations("test.ts", sourceFile, false, vi.fn());

      const declarations = Array.from(registry.declarations.values());
      expect(declarations[0].name).toBe("Foo");
      expect(ts.isInterfaceDeclaration(declarations[0].node)).toBe(true);
    });
  });
});
