import ts from "typescript";
import { beforeEach, describe, expect, it } from "vitest";
import { TypeRegistry } from "../registry";
import { TreeShaker } from "../tree-shaker";
import { ExportKind, type TypeDeclaration } from "../types";

describe("TreeShaker", () => {
  let shaker: TreeShaker;
  let registry: TypeRegistry;

  beforeEach(() => {
    registry = new TypeRegistry();
  });

  describe("shake", () => {
    it("should return empty results for empty registry", () => {
      shaker = new TreeShaker(registry);
      const result = shaker.shake();

      expect(result.declarations.size).toBe(0);
      expect(result.externalImports.size).toBe(0);
      expect(result.detectedTypesLibraries.size).toBe(0);
      expect(result.declarationOrder.size).toBe(0);
    });

    it("should include force included declarations", () => {
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
        forceInclude: true,
        isFromInlinedLibrary: false,
        usedInGlobal: false,
        usedInNonGlobal: false,
        mergeGroup: null,
      } as unknown as TypeDeclaration;

      registry.register(declaration);
      shaker = new TreeShaker(registry);
      const result = shaker.shake();

      expect(result.declarations.has(declaration.id)).toBe(true);
    });

    it("should not include non-force-included declarations", () => {
      const sourceFile = ts.createSourceFile("test.ts", "interface Foo {}", ts.ScriptTarget.Latest, true);
      const declaration = {
        id: Symbol("test"),
        name: "Foo",
        normalizedName: "Foo",
        sourceFile: "test.ts",
        node: sourceFile.statements[0],
        sourceFileNode: sourceFile,
        exportInfo: { kind: ExportKind.NotExported, wasOriginallyExported: false },
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
      shaker = new TreeShaker(registry);
      const result = shaker.shake();

      expect(result.declarations.size).toBe(0);
    });

    it("should include transitive dependencies", () => {
      const sourceFile = ts.createSourceFile(
        "test.ts",
        "interface Foo {} interface Bar {}",
        ts.ScriptTarget.Latest,
        true,
      );
      const fooId = Symbol("foo");
      const barId = Symbol("bar");

      const fooDecl = {
        id: fooId,
        name: "Foo",
        normalizedName: "Foo",
        sourceFile: "test.ts",
        node: sourceFile.statements[0],
        sourceFileNode: sourceFile,
        exportInfo: { kind: ExportKind.Named, wasOriginallyExported: true },
        isTypeOnly: false,
        dependencies: new Set([barId]),
        externalDependencies: new Map(),
        namespaceDependencies: new Set(),
        importAliases: new Map(),
        forceInclude: true,
        isFromInlinedLibrary: false,
        usedInGlobal: false,
        usedInNonGlobal: false,
        mergeGroup: null,
      } as unknown as TypeDeclaration;

      const barDecl = {
        id: barId,
        name: "Bar",
        normalizedName: "Bar",
        sourceFile: "test.ts",
        node: sourceFile.statements[1],
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

      registry.register(fooDecl);
      registry.register(barDecl);

      shaker = new TreeShaker(registry);
      const result = shaker.shake();

      expect(result.declarations.has(fooId)).toBe(true);
      expect(result.declarations.has(barId)).toBe(true);
    });

    it("should track declaration order", () => {
      const sourceFile = ts.createSourceFile(
        "test.ts",
        "interface Foo {} interface Bar {}",
        ts.ScriptTarget.Latest,
        true,
      );
      const fooId = Symbol("foo");

      const fooDecl = {
        id: fooId,
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
        forceInclude: true,
        isFromInlinedLibrary: false,
        usedInGlobal: false,
        usedInNonGlobal: false,
        mergeGroup: null,
      } as unknown as TypeDeclaration;

      registry.register(fooDecl);
      shaker = new TreeShaker(registry);
      const result = shaker.shake();

      expect(result.declarationOrder.has(fooId)).toBe(true);
      expect(result.declarationOrder.get(fooId)).toBe(0);
    });
  });

  describe("with entry file", () => {
    it("should mark entry file named exports as used", () => {
      const sourceFile = ts.createSourceFile(
        "entry.ts",
        "export interface Foo {} export interface Bar {}",
        ts.ScriptTarget.Latest,
        true,
      );

      const fooId = Symbol("foo");
      const declaration = {
        id: fooId,
        name: "Foo",
        normalizedName: "Foo",
        sourceFile: "entry.ts",
        node: sourceFile.statements[0],
        sourceFileNode: sourceFile,
        exportInfo: { kind: ExportKind.Named, wasOriginallyExported: true },
        isTypeOnly: false,
        dependencies: new Set(),
        externalDependencies: new Map(),
        namespaceDependencies: new Set(),
        importAliases: new Map(),
        forceInclude: true,
        isFromInlinedLibrary: false,
        usedInGlobal: false,
        usedInNonGlobal: false,
        mergeGroup: null,
      } as unknown as TypeDeclaration;

      registry.register(declaration);
      registry.registerExportedName("entry.ts", { name: "Foo", sourceFile: "entry.ts" });

      shaker = new TreeShaker(registry, { entryFile: "entry.ts" });
      const result = shaker.shake();

      expect(result.declarations.has(fooId)).toBe(true);
    });

    it("should include module declarations from entry file", () => {
      const sourceFile = ts.createSourceFile(
        "entry.ts",
        "declare module 'foo' { interface Foo {} }",
        ts.ScriptTarget.Latest,
        true,
      );

      const moduleId = Symbol("module");
      const moduleDecl = {
        id: moduleId,
        name: "foo",
        normalizedName: "foo",
        sourceFile: "entry.ts",
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

      registry.register(moduleDecl);

      shaker = new TreeShaker(registry, { entryFile: "entry.ts" });
      const result = shaker.shake();

      expect(result.declarations.has(moduleId)).toBe(true);
    });
  });

  describe("external imports tracking", () => {
    it("should collect used external imports", () => {
      const sourceFile = ts.createSourceFile("test.ts", "interface Foo {}", ts.ScriptTarget.Latest, true);

      const externalId = Symbol("ext");
      registry.registerExternal("lodash", "pick", false);

      const declaration = {
        id: externalId,
        name: "Foo",
        normalizedName: "Foo",
        sourceFile: "test.ts",
        node: sourceFile.statements[0],
        sourceFileNode: sourceFile,
        exportInfo: { kind: ExportKind.Named, wasOriginallyExported: true },
        isTypeOnly: false,
        dependencies: new Set(),
        externalDependencies: new Map([["lodash", new Set(["pick"])]]),
        namespaceDependencies: new Set(),
        importAliases: new Map(),
        forceInclude: true,
        isFromInlinedLibrary: false,
        usedInGlobal: false,
        usedInNonGlobal: false,
        mergeGroup: null,
      } as unknown as TypeDeclaration;

      registry.register(declaration);

      shaker = new TreeShaker(registry);
      const result = shaker.shake();

      expect(result.externalImports.get("lodash")?.size).toBe(1);
    });
  });

  describe("types libraries detection", () => {
    it("should detect types libraries from used externals", () => {
      const sourceFile = ts.createSourceFile("test.ts", "interface Foo {}", ts.ScriptTarget.Latest, true);

      registry.registerExternal("node", "fs", false, false, "node");

      const declaration = {
        id: Symbol("decl"),
        name: "Foo",
        normalizedName: "Foo",
        sourceFile: "test.ts",
        node: sourceFile.statements[0],
        sourceFileNode: sourceFile,
        exportInfo: { kind: ExportKind.Named, wasOriginallyExported: true },
        isTypeOnly: false,
        dependencies: new Set(),
        externalDependencies: new Map([["node", new Set(["fs"])]]),
        namespaceDependencies: new Set(),
        importAliases: new Map(),
        forceInclude: true,
        isFromInlinedLibrary: false,
        usedInGlobal: false,
        usedInNonGlobal: false,
        mergeGroup: null,
      } as unknown as TypeDeclaration;

      registry.register(declaration);

      shaker = new TreeShaker(registry);
      const result = shaker.shake();

      expect(result.detectedTypesLibraries.has("node")).toBe(true);
    });
  });
});
