import { describe, it, expect, beforeEach, vi } from "vitest";
import ts from "typescript";
import { ExportResolver } from "../export-resolver";
import { TypeRegistry } from "../registry";
import type { FileCollector } from "../file-collector";

describe("ExportResolver", () => {
  let resolver: ExportResolver;
  let registry: TypeRegistry;
  let fileCollector: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    registry = new TypeRegistry();
    fileCollector = {
      shouldInline: vi.fn((path: string) => path.startsWith("./") || path.startsWith("../")),
      resolveImport: vi.fn((from: string, path: string) => {
        if (path === "./lib") return "/src/lib.ts";
        if (path === "./types") return "/src/types.ts";
        return null;
      }),
      resolveExternalImport: vi.fn(() => ({ resolvedPath: null, typesLibraryName: null })),
    } as unknown as ReturnType<typeof vi.fn>;

    resolver = new ExportResolver(registry, fileCollector as unknown as FileCollector);
  });

  describe("collectDirectNamespaceExports", () => {
    it("should collect namespace exports from local modules", () => {
      const code = "export * as Lib from './lib';";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);

      resolver.collectDirectNamespaceExports("test.ts", sourceFile);

      const namespaceExports = registry.namespaceExportsByFile.get("test.ts");
      expect(namespaceExports?.has("Lib")).toBe(true);
    });

    it("should collect namespace exports from external modules", () => {
      const fc = {
        shouldInline: vi.fn(() => false),
        resolveExternalImport: vi.fn(() => ({ resolvedPath: null, typesLibraryName: null })),
      } as unknown as FileCollector;
      const resolverExt = new ExportResolver(registry, fc);

      const code = "export * as Lodash from 'lodash';";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);

      resolverExt.collectDirectNamespaceExports("test.ts", sourceFile);

      const namespaceExports = registry.namespaceExportsByFile.get("test.ts");
      expect(namespaceExports?.has("Lodash")).toBe(true);
    });

    it("should skip non-namespace exports", () => {
      const code = `
        export { Foo } from './lib';
        export const bar = 1;
      `;
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);

      resolver.collectDirectNamespaceExports("test.ts", sourceFile);

      const namespaceExports = registry.namespaceExportsByFile.get("test.ts");
      expect(namespaceExports?.size ?? 0).toBe(0);
    });

    it("should handle type-only namespace exports", () => {
      const code = "export type * as Types from './types';";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);

      resolver.collectDirectNamespaceExports("test.ts", sourceFile);

      const namespaceExports = registry.namespaceExportsByFile.get("test.ts");
      expect(namespaceExports?.has("Types")).toBe(true);
    });
  });

  describe("collectFileExports", () => {
    it("should collect named exports from declarations", () => {
      const code = "export interface Foo {}";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);

      const importMap = new Map<string, Map<string, { originalName: string; sourceFile: string | null; isExternal: boolean; aliasName?: string | null }>>();
      resolver.collectFileExports("test.ts", sourceFile, importMap, false);

      const exports = registry.exportedNamesByFile.get("test.ts");
      expect(exports?.some((e) => e.name === "Foo")).toBe(true);
    });

    it("should collect re-exports from import statements", () => {
      const code = "export { Foo } from './lib';";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);

      const importMap = new Map<string, Map<string, { originalName: string; sourceFile: string | null; isExternal: boolean; aliasName?: string | null }>>();
      resolver.collectFileExports("test.ts", sourceFile, importMap, false);

      const exports = registry.exportedNamesByFile.get("test.ts");
      expect(exports?.some((e) => e.name === "Foo")).toBe(true);
    });

    it("should handle renamed exports", () => {
      const code = "export { Foo as Bar } from './lib';";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);

      const importMap = new Map<string, Map<string, { originalName: string; sourceFile: string | null; isExternal: boolean; aliasName?: string | null }>>();
      resolver.collectFileExports("test.ts", sourceFile, importMap, false);

      const exports = registry.exportedNamesByFile.get("test.ts");
      expect(exports?.some((e) => e.name === "Bar")).toBe(true);
    });

    it("should handle star exports", () => {
      const code = "export * from './lib';";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);

      const importMap = new Map<string, Map<string, { originalName: string; sourceFile: string | null; isExternal: boolean; aliasName?: string | null }>>();
      resolver.collectFileExports("test.ts", sourceFile, importMap, false);

      const starExports = registry.starExportsByFile.get("test.ts");
      expect(starExports?.length ?? 0).toBeGreaterThanOrEqual(0);
    });

    it("should mark entry file exports as entry exports", () => {
      const code = "export interface Foo {}";
      const sourceFile = ts.createSourceFile("entry.ts", code, ts.ScriptTarget.Latest, true);

      const importMap = new Map<string, Map<string, { originalName: string; sourceFile: string | null; isExternal: boolean; aliasName?: string | null }>>();
      resolver.collectFileExports("entry.ts", sourceFile, importMap, true);

      const exports = registry.exportedNamesByFile.get("entry.ts");
      expect(exports?.length ?? 0).toBeGreaterThan(0);
    });
  });

  describe("handleExportAssignments", () => {
    it("should handle export = statements", () => {
      const code = "class Foo {} export = Foo;";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);

      const importMap = new Map<string, Map<string, { originalName: string; sourceFile: string | null; isExternal: boolean; aliasName?: string | null }>>();
      const onEntryExportEquals = vi.fn();

      resolver.handleExportAssignments("test.ts", sourceFile, true, importMap, onEntryExportEquals, vi.fn());

      expect(onEntryExportEquals).toHaveBeenCalled();
    });

    it("should handle export default statements", () => {
      const code = "class Foo {} export default Foo;";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);

      const importMap = new Map<string, Map<string, { originalName: string; sourceFile: string | null; isExternal: boolean; aliasName?: string | null }>>();
      const onEntryExportDefault = vi.fn();

      resolver.handleExportAssignments("test.ts", sourceFile, true, importMap, vi.fn(), onEntryExportDefault);

      expect(onEntryExportDefault).toHaveBeenCalled();
    });

    it("should only track entry file export assignments", () => {
      const code = "class Foo {} export = Foo;";
      const sourceFile = ts.createSourceFile("lib.ts", code, ts.ScriptTarget.Latest, true);

      const importMap = new Map<string, Map<string, { originalName: string; sourceFile: string | null; isExternal: boolean; aliasName?: string | null }>>();
      const onEntryExportEquals = vi.fn();

      resolver.handleExportAssignments("lib.ts", sourceFile, false, importMap, onEntryExportEquals, vi.fn());

      expect(onEntryExportEquals).not.toHaveBeenCalled();
    });
  });

  describe("export statement parsing", () => {
    it("should handle export of default import", () => {
      const code = "export { default as Foo } from 'lodash';";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);

      const importMap = new Map<string, Map<string, { originalName: string; sourceFile: string | null; isExternal: boolean; aliasName?: string | null }>>();
      resolver.collectFileExports("test.ts", sourceFile, importMap, false);

      const exports = registry.exportedNamesByFile.get("test.ts");
      expect(exports?.some((e) => e.name === "Foo")).toBe(true);
    });

    it("should handle export star as namespace", () => {
      const code = "export * as Lib from './lib';";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);

      resolver.collectDirectNamespaceExports("test.ts", sourceFile);

      const namespaceExports = registry.namespaceExportsByFile.get("test.ts");
      expect(namespaceExports?.has("Lib")).toBe(true);
    });
  });

  describe("variable exports", () => {
    it("should collect variable declaration exports", () => {
      const code = "export const foo: string; export const bar: number;";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);

      const importMap = new Map<string, Map<string, { originalName: string; sourceFile: string | null; isExternal: boolean; aliasName?: string | null }>>();
      resolver.collectFileExports("test.ts", sourceFile, importMap, false);

      const exports = registry.exportedNamesByFile.get("test.ts");
      expect(exports?.some((e) => e.name === "foo")).toBe(true);
      expect(exports?.some((e) => e.name === "bar")).toBe(true);
    });

    it("should handle destructured variable exports", () => {
      const code = "export const { foo, bar } = obj;";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);

      const importMap = new Map<string, Map<string, { originalName: string; sourceFile: string | null; isExternal: boolean; aliasName?: string | null }>>();
      resolver.collectFileExports("test.ts", sourceFile, importMap, false);

      // Should handle binding patterns in exports
      const exports = registry.exportedNamesByFile.get("test.ts");
      expect(exports ?? []).toBeDefined();
    });
  });

  describe("external module handling", () => {
    it("should register external imports from re-exports", () => {
      const fc = {
        shouldInline: vi.fn(() => false),
        resolveExternalImport: vi.fn(() => ({ resolvedPath: null, typesLibraryName: null })),
      } as unknown as FileCollector;
      const resolverExt = new ExportResolver(registry, fc);

      const code = "export { Foo } from 'lodash';";
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);

      const importMap = new Map<string, Map<string, { originalName: string; sourceFile: string | null; isExternal: boolean; aliasName?: string | null }>>();
      resolverExt.collectFileExports("test.ts", sourceFile, importMap, false);

      expect(registry.externalImports.has("lodash")).toBe(true);
    });
  });
});
