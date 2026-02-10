import ts from "typescript";
import { beforeEach, describe, expect, it } from "vitest";
import { TypeRegistry } from "../registry";
import { ExportKind, type TypeDeclaration } from "../types";

describe("TypeRegistry", () => {
  let registry: TypeRegistry;

  beforeEach(() => {
    registry = new TypeRegistry();
  });

  describe("register", () => {
    it("should register a declaration", () => {
      const sourceFile = ts.createSourceFile("test.ts", "interface Foo {}", ts.ScriptTarget.Latest, true);
      const declaration = {
        id: Symbol("test"),
        name: "Foo",
        normalizedName: "Foo",
        sourceFile: "test.ts",
        node: sourceFile.statements[0],
        sourceFileNode: sourceFile,
        exportInfo: { kind: ExportKind.Named, wasOriginallyExported: true },
        isTypeOnly: false,
        dependencies: new Set(),
        externalDependencies: new Map(),
        namespaceDependencies: new Set(),
        importAliases: new Map(),
        forceInclude: false,
        isFromInlinedLibrary: false,
        usedInGlobal: false,
        usedInNonGlobal: false,
        mergeGroup: null,
      } as unknown as TypeDeclaration;

      registry.register(declaration);
      expect(registry.declarations.has(declaration.id)).toBe(true);
    });

    it("should index declaration by file and name", () => {
      const sourceFile = ts.createSourceFile("test.ts", "interface Foo {}", ts.ScriptTarget.Latest, true);
      const declaration = {
        id: Symbol("test"),
        name: "Foo",
        normalizedName: "Foo",
        sourceFile: "test.ts",
        node: sourceFile.statements[0],
        sourceFileNode: sourceFile,
        exportInfo: { kind: ExportKind.Named, wasOriginallyExported: true },
        isTypeOnly: false,
        dependencies: new Set(),
        externalDependencies: new Map(),
        namespaceDependencies: new Set(),
        importAliases: new Map(),
        forceInclude: false,
        isFromInlinedLibrary: false,
        usedInGlobal: false,
        usedInNonGlobal: false,
        mergeGroup: null,
      } as unknown as TypeDeclaration;

      registry.register(declaration);
      const key = `test.ts:Foo`;
      expect(registry.nameIndex.has(key)).toBe(true);
      expect(registry.nameIndex.get(key)?.has(declaration.id)).toBe(true);
    });

    it("should track declarations by file", () => {
      const sourceFile = ts.createSourceFile("test.ts", "interface Foo {}", ts.ScriptTarget.Latest, true);
      const declaration = {
        id: Symbol("test"),
        name: "Foo",
        normalizedName: "Foo",
        sourceFile: "test.ts",
        node: sourceFile.statements[0],
        sourceFileNode: sourceFile,
        exportInfo: { kind: ExportKind.Named, wasOriginallyExported: true },
        isTypeOnly: false,
        dependencies: new Set(),
        externalDependencies: new Map(),
        namespaceDependencies: new Set(),
        importAliases: new Map(),
        forceInclude: false,
        isFromInlinedLibrary: false,
        usedInGlobal: false,
        usedInNonGlobal: false,
        mergeGroup: null,
      } as unknown as TypeDeclaration;

      registry.register(declaration);
      expect(registry.declarationsByFile.has("test.ts")).toBe(true);
      expect(registry.declarationsByFile.get("test.ts")?.has(declaration.id)).toBe(true);
    });
  });

  describe("registerExternal", () => {
    it("should register external import", () => {
      const imported = registry.registerExternal("lodash", "pick", false);
      expect(imported.moduleName).toBe("lodash");
      expect(imported.originalName).toBe("pick");
      expect(imported.isTypeOnly).toBe(false);
    });

    it("should reuse existing external import", () => {
      const imported1 = registry.registerExternal("lodash", "pick", false);
      const imported2 = registry.registerExternal("lodash", "pick", false);
      expect(imported1).toBe(imported2);
    });

    it("should track external imports by module", () => {
      registry.registerExternal("lodash", "pick", false);
      registry.registerExternal("lodash", "map", false);
      registry.registerExternal("moment", "now", false);

      expect(registry.externalImports.get("lodash")?.size).toBe(2);
      expect(registry.externalImports.get("moment")?.size).toBe(1);
    });

    it("should handle type-only imports", () => {
      const imported = registry.registerExternal("typescript", "Type", true);
      expect(imported.isTypeOnly).toBe(true);
    });

    it("should handle default imports", () => {
      const imported = registry.registerExternal("lodash", "default", false, true);
      expect(imported.isDefaultImport).toBe(true);
    });

    it("should track types library name", () => {
      const imported = registry.registerExternal("node", "fs", false, false, "node");
      expect(imported.typesLibraryName).toBe("node");
    });
  });

  describe("registerNamespaceExport", () => {
    it("should register namespace export for local file", () => {
      registry.registerNamespaceExport("entry.ts", { name: "Foo", targetFile: "lib.ts" }, false);
      const exports = registry.namespaceExportsByFile.get("entry.ts");
      expect(exports?.has("Foo")).toBe(true);
    });

    it("should register namespace export for external module", () => {
      registry.registerNamespaceExport(
        "entry.ts",
        { name: "Foo", externalModule: "lodash", externalImportName: "* as Foo" },
        false,
      );
      const exports = registry.namespaceExportsByFile.get("entry.ts");
      expect(exports?.has("Foo")).toBe(true);
    });

    it("should track namespace exports", () => {
      registry.registerNamespaceExport(
        "entry.ts",
        { name: "Foo", externalModule: "lodash", externalImportName: "* as Foo" },
        false,
      );
      const exports = registry.namespaceExportsByFile.get("entry.ts");
      expect(exports?.has("Foo")).toBe(true);
    });
  });

  describe("registerExportedName", () => {
    it("should register exported name", () => {
      registry.registerExportedName("entry.ts", { name: "Foo", sourceFile: "lib.ts", originalName: "IFoo" });
      const exports = registry.exportedNamesByFile.get("entry.ts");
      expect(exports?.length).toBe(1);
      expect(exports?.[0].name).toBe("Foo");
    });

    it("should register exported names for modules", () => {
      registry.registerExportedName("entry.ts", { name: "Foo", externalModule: "lodash" });
      const exports = registry.exportedNamesByFile.get("entry.ts");
      expect(exports?.some((e) => e.name === "Foo")).toBe(true);
    });
  });
});
