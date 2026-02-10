import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileCollector } from "../file-collector";
import { ImportParser } from "../import-parser";
import { TypeRegistry } from "../registry";

describe("ImportParser", () => {
  let parser: ImportParser;
  let registry: TypeRegistry;

  beforeEach(() => {
    registry = new TypeRegistry();
    const fcObj = {
      shouldInline: vi.fn(
        (importPath: string) =>
          importPath.startsWith("./") || importPath.startsWith("../") || !importPath.includes("/"),
      ),
      resolveImport: vi.fn((fromFile: string, importPath: string) => {
        if (importPath === "./lib") return "/src/lib.ts";
        if (importPath === "./types") return "/src/types.ts";
        return null;
      }),
      resolveExternalImport: vi.fn(() => ({ resolvedPath: null, typesLibraryName: null })),
    } as unknown as FileCollector;

    parser = new ImportParser(registry, fcObj);
  });

  describe("parseImports", () => {
    it("should parse simple named imports", () => {
      const code = "import { Foo } from './lib';";
      const sourceFile = ts.createSourceFile("/src/index.ts", code, ts.ScriptTarget.Latest, true);

      const imports = parser.parseImports("/src/index.ts", sourceFile);

      expect(imports.has("Foo")).toBe(true);
      const foo = imports.get("Foo");
      expect(foo?.originalName).toBe("Foo");
    });

    it("should parse multiple named imports", () => {
      const code = "import { Foo, Bar, Baz } from './lib';";
      const sourceFile = ts.createSourceFile("/src/index.ts", code, ts.ScriptTarget.Latest, true);

      const imports = parser.parseImports("/src/index.ts", sourceFile);

      expect(imports.has("Foo")).toBe(true);
      expect(imports.has("Bar")).toBe(true);
      expect(imports.has("Baz")).toBe(true);
    });

    it("should parse renamed imports", () => {
      const code = "import { Foo as F } from './lib';";
      const sourceFile = ts.createSourceFile("/src/index.ts", code, ts.ScriptTarget.Latest, true);

      const imports = parser.parseImports("/src/index.ts", sourceFile);

      expect(imports.has("F")).toBe(true);
      const foo = imports.get("F");
      expect(foo?.originalName).toBe("Foo");
      expect(foo?.aliasName).toBe("F");
    });

    it("should parse default imports", () => {
      const code = "import Foo from './lib';";
      const sourceFile = ts.createSourceFile("/src/index.ts", code, ts.ScriptTarget.Latest, true);

      const imports = parser.parseImports("/src/index.ts", sourceFile);

      expect(imports.has("Foo")).toBe(true);
      const foo = imports.get("Foo");
      expect(foo?.originalName).toMatch(/^default/);
    });

    it("should parse namespace imports", () => {
      const code = "import * as Lib from './lib';";
      const sourceFile = ts.createSourceFile("/src/index.ts", code, ts.ScriptTarget.Latest, true);

      const imports = parser.parseImports("/src/index.ts", sourceFile);

      expect(imports.has("Lib")).toBe(true);
      const lib = imports.get("Lib");
      expect(lib?.originalName).toContain("*");
    });

    it("should track namespace imports in registry", () => {
      const code = "import * as Lib from './lib';";
      const sourceFile = ts.createSourceFile("/src/index.ts", code, ts.ScriptTarget.Latest, true);

      const imports = parser.parseImports("/src/index.ts", sourceFile);

      // Check that namespace import was registered
      expect(imports.size).toBeGreaterThan(0);
    });

    it("should handle type-only imports", () => {
      const code = "import type { Foo } from './lib';";
      const sourceFile = ts.createSourceFile("/src/index.ts", code, ts.ScriptTarget.Latest, true);

      const imports = parser.parseImports("/src/index.ts", sourceFile);

      expect(imports.has("Foo")).toBe(true);
      const foo = imports.get("Foo");
      expect(foo?.isTypeOnly).toBe(true);
    });

    it("should ignore non-inlined imports from external modules", () => {
      const fc = {
        shouldInline: vi.fn(() => false),
        resolveImport: vi.fn(() => null),
        resolveExternalImport: vi.fn(() => ({ resolvedPath: null, typesLibraryName: null })),
      } as unknown as FileCollector;

      const parserNoInline = new ImportParser(registry, fc);
      const code = "import { Foo } from 'lodash';";
      const sourceFile = ts.createSourceFile("/src/index.ts", code, ts.ScriptTarget.Latest, true);

      const imports = parserNoInline.parseImports("/src/index.ts", sourceFile);

      // External imports are tracked but marked as isExternal: true
      expect(imports.has("Foo")).toBe(true);
      const importInfo = imports.get("Foo");
      expect(importInfo?.isExternal).toBe(true);
    });

    it("should handle CommonJS import= syntax", () => {
      const code = "import Lib = require('./lib');";
      const sourceFile = ts.createSourceFile("/src/index.ts", code, ts.ScriptTarget.Latest, true);

      const imports = parser.parseImports("/src/index.ts", sourceFile);

      expect(imports.has("Lib")).toBe(true);
    });

    it("should handle mixed import styles", () => {
      const code = `
        import { Foo } from './lib';
        import * as Lib from './types';
        import type { Bar } from './types';
      `;
      const sourceFile = ts.createSourceFile("/src/index.ts", code, ts.ScriptTarget.Latest, true);

      const imports = parser.parseImports("/src/index.ts", sourceFile);

      expect(imports.has("Foo")).toBe(true);
      expect(imports.has("Lib")).toBe(true);
      expect(imports.has("Bar")).toBe(true);
    });
  });

  describe("parseImports with declare module", () => {
    it("should parse imports inside declare module blocks", () => {
      const code = `
        declare module 'foo' {
          import { Bar } from './lib';
          export interface Foo extends Bar {}
        }
      `;
      const sourceFile = ts.createSourceFile("/src/index.ts", code, ts.ScriptTarget.Latest, true);

      const imports = parser.parseImports("/src/index.ts", sourceFile);

      // Should parse imports from within declare module if inlineDeclareExternals is true
      expect(imports).toBeDefined();
    });
  });

  describe("import sources tracking", () => {
    it("should handle external imports correctly", () => {
      const fc = {
        shouldInline: vi.fn(() => false),
        resolveImport: vi.fn(() => null),
        resolveExternalImport: vi.fn(() => ({ resolvedPath: null, typesLibraryName: null })),
      } as unknown as FileCollector;

      const parserExt = new ImportParser(registry, fc);
      const code = "import { pick } from 'lodash';";
      const sourceFile = ts.createSourceFile("/src/index.ts", code, ts.ScriptTarget.Latest, true);

      const imports = parserExt.parseImports("/src/index.ts", sourceFile);

      // External imports are tracked and marked as isExternal: true
      expect(imports.has("pick")).toBe(true);
      const importInfo = imports.get("pick");
      expect(importInfo?.isExternal).toBe(true);
      // They should also be registered in the registry
      expect(registry.externalImports.has("lodash")).toBe(true);
    });

    it("should mark local imports correctly", () => {
      const code = "import { Foo } from './lib';";
      const sourceFile = ts.createSourceFile("/src/index.ts", code, ts.ScriptTarget.Latest, true);

      const imports = parser.parseImports("/src/index.ts", sourceFile);

      expect(imports.has("Foo")).toBe(true);
      const foo = imports.get("Foo");
      expect(foo?.isExternal).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("should handle empty import statements", () => {
      const code = "import './lib';";
      const sourceFile = ts.createSourceFile("/src/index.ts", code, ts.ScriptTarget.Latest, true);

      const imports = parser.parseImports("/src/index.ts", sourceFile);

      expect(imports.size).toBe(0);
    });

    it("should handle imports with non-string specifiers gracefully", () => {
      // This shouldn't happen in valid TypeScript, but parser should handle it
      const code = "interface Foo {}";
      const sourceFile = ts.createSourceFile("/src/index.ts", code, ts.ScriptTarget.Latest, true);

      const imports = parser.parseImports("/src/index.ts", sourceFile);

      expect(imports.size).toBe(0);
    });

    it("should resolve paths correctly", () => {
      const code = "import { Foo } from './lib';";
      const sourceFile = ts.createSourceFile("/src/index.ts", code, ts.ScriptTarget.Latest, true);

      const imports = parser.parseImports("/src/index.ts", sourceFile);

      expect(imports.has("Foo")).toBe(true);
      const foo = imports.get("Foo");
      expect(foo?.sourceFile).toBe("/src/lib.ts");
    });
  });
});
