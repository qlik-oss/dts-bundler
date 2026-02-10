import ts from "typescript";
import { describe, expect, it } from "vitest";
import { ExportKind, ExternalImport } from "../types";

describe("Types and Enums", () => {
  describe("ExportKind enum", () => {
    it("should have all export kinds defined", () => {
      expect(ExportKind.NotExported).toBeDefined();
      expect(ExportKind.Named).toBeDefined();
      expect(ExportKind.NamedAndDefault).toBeDefined();
      expect(ExportKind.Default).toBeDefined();
      expect(ExportKind.DefaultOnly).toBeDefined();
      expect(ExportKind.Equals).toBeDefined();
    });

    it("should have unique string values", () => {
      const values = Object.values(ExportKind);
      const uniqueValues = new Set(values);
      expect(uniqueValues.size).toBe(values.length);
    });
  });

  describe("ExternalImport class", () => {
    it("should create external import with basic parameters", () => {
      const imp = new ExternalImport("lodash", "pick", false);
      expect(imp.moduleName).toBe("lodash");
      expect(imp.originalName).toBe("pick");
      expect(imp.isTypeOnly).toBe(false);
    });

    it("should handle type-only imports", () => {
      const imp = new ExternalImport("typescript", "Type", true);
      expect(imp.isTypeOnly).toBe(true);
    });

    it("should handle default imports", () => {
      const imp = new ExternalImport("react", "default", false, true);
      expect(imp.isDefaultImport).toBe(true);
    });

    it("should track types library name", () => {
      const imp = new ExternalImport("node", "fs", false, false, "node");
      expect(imp.typesLibraryName).toBe("node");
    });

    it("should allow updating isTypeOnly", () => {
      const imp = new ExternalImport("lodash", "pick", true);
      expect(imp.isTypeOnly).toBe(true);
      imp.isTypeOnly = false;
      expect(imp.isTypeOnly).toBe(false);
    });

    it("should allow updating typesLibraryName", () => {
      const imp = new ExternalImport("pkg", "export", false);
      expect(imp.typesLibraryName).toBeNull();
      imp.typesLibraryName = "@types/pkg";
      expect(imp.typesLibraryName).toBe("@types/pkg");
    });
  });

  describe("TypeDeclaration class", () => {
    it("should create a type declaration", () => {
      const sourceFile = ts.createSourceFile("test.ts", "interface Foo {}", ts.ScriptTarget.Latest, true);
      const node = sourceFile.statements[0];

      const decl = {
        id: Symbol("test"),
        name: "Foo",
        normalizedName: "Foo",
        sourceFile: "test.ts",
        node,
        exportInfo: { kind: ExportKind.Named, wasOriginallyExported: true },
        dependencies: new Set(),
        externalDependencies: new Map(),
        namespaceDependencies: new Set(),
        importAliases: new Map(),
        forceInclude: false,
        isFromInlinedLibrary: false,
        usedInGlobal: false,
        usedInNonGlobal: false,
      };

      expect(decl.name).toBe("Foo");
      expect(decl.normalizedName).toBe("Foo");
      expect(decl.sourceFile).toBe("test.ts");
    });

    it("should track dependencies", () => {
      const sourceFile = ts.createSourceFile("test.ts", "interface Foo {}", ts.ScriptTarget.Latest, true);
      const depId = Symbol("dep");

      const decl = {
        id: Symbol("test"),
        name: "Foo",
        normalizedName: "Foo",
        sourceFile: "test.ts",
        node: sourceFile.statements[0],
        exportInfo: { kind: ExportKind.Named, wasOriginallyExported: true },
        dependencies: new Set([depId]),
        externalDependencies: new Map(),
        namespaceDependencies: new Set(),
        importAliases: new Map(),
        forceInclude: false,
        isFromInlinedLibrary: false,
        usedInGlobal: false,
        usedInNonGlobal: false,
      };

      expect(decl.dependencies.has(depId)).toBe(true);
    });

    it("should track external dependencies", () => {
      const sourceFile = ts.createSourceFile("test.ts", "interface Foo {}", ts.ScriptTarget.Latest, true);

      const decl = {
        id: Symbol("test"),
        name: "Foo",
        normalizedName: "Foo",
        sourceFile: "test.ts",
        node: sourceFile.statements[0],
        exportInfo: { kind: ExportKind.Named, wasOriginallyExported: true },
        dependencies: new Set(),
        externalDependencies: new Map([["lodash", new Set(["pick", "map"])]]),
        namespaceDependencies: new Set(),
        importAliases: new Map(),
        forceInclude: false,
        isFromInlinedLibrary: false,
        usedInGlobal: false,
        usedInNonGlobal: false,
      };

      expect(decl.externalDependencies.has("lodash")).toBe(true);
      expect(decl.externalDependencies.get("lodash")?.has("pick")).toBe(true);
    });

    it("should track import aliases", () => {
      const sourceFile = ts.createSourceFile("test.ts", "interface Foo {}", ts.ScriptTarget.Latest, true);

      const decl = {
        id: Symbol("test"),
        name: "Foo",
        normalizedName: "Foo",
        sourceFile: "test.ts",
        node: sourceFile.statements[0],
        exportInfo: { kind: ExportKind.Named, wasOriginallyExported: true },
        dependencies: new Set(),
        externalDependencies: new Map(),
        namespaceDependencies: new Set(),
        importAliases: new Map([["LocalAlias", { sourceFile: "lib.ts", originalName: "OriginalName" }]]),
        forceInclude: false,
        isFromInlinedLibrary: false,
        usedInGlobal: false,
        usedInNonGlobal: false,
      };

      expect(decl.importAliases.has("LocalAlias")).toBe(true);
      const alias = decl.importAliases.get("LocalAlias");
      expect(alias?.originalName).toBe("OriginalName");
    });

    it("should track usage in global and non-global contexts", () => {
      const sourceFile = ts.createSourceFile("test.ts", "interface Foo {}", ts.ScriptTarget.Latest, true);

      const decl = {
        id: Symbol("test"),
        name: "Foo",
        normalizedName: "Foo",
        sourceFile: "test.ts",
        node: sourceFile.statements[0],
        exportInfo: { kind: ExportKind.Named, wasOriginallyExported: true },
        dependencies: new Set(),
        externalDependencies: new Map(),
        namespaceDependencies: new Set(),
        importAliases: new Map(),
        forceInclude: false,
        isFromInlinedLibrary: false,
        usedInGlobal: true,
        usedInNonGlobal: false,
      };

      expect(decl.usedInGlobal).toBe(true);
      expect(decl.usedInNonGlobal).toBe(false);
    });

    it("should track type-only declarations", () => {
      const sourceFile = ts.createSourceFile("test.ts", "interface Foo {}", ts.ScriptTarget.Latest, true);

      const decl = {
        id: Symbol("test"),
        name: "Foo",
        normalizedName: "Foo",
        sourceFile: "test.ts",
        node: sourceFile.statements[0],
        exportInfo: { kind: ExportKind.Named, wasOriginallyExported: true },
        dependencies: new Set(),
        externalDependencies: new Map(),
        namespaceDependencies: new Set(),
        importAliases: new Map(),
        forceInclude: false,
        isFromInlinedLibrary: false,
        usedInGlobal: false,
        usedInNonGlobal: false,
        isTypeOnly: true,
      };

      expect(decl.isTypeOnly).toBe(true);
    });

    it("should track inlined library status", () => {
      const sourceFile = ts.createSourceFile("test.ts", "interface Foo {}", ts.ScriptTarget.Latest, true);

      const decl = {
        id: Symbol("test"),
        name: "Foo",
        normalizedName: "Foo",
        sourceFile: "node_modules/lib/index.ts",
        node: sourceFile.statements[0],
        exportInfo: { kind: ExportKind.Named, wasOriginallyExported: true },
        dependencies: new Set(),
        externalDependencies: new Map(),
        namespaceDependencies: new Set(),
        importAliases: new Map(),
        forceInclude: false,
        isFromInlinedLibrary: true,
        usedInGlobal: false,
        usedInNonGlobal: false,
      };

      expect(decl.isFromInlinedLibrary).toBe(true);
    });
  });

  describe("ExportInfo interface", () => {
    it("should define export kind and original export status", () => {
      const exportInfo = {
        kind: ExportKind.Named,
        wasOriginallyExported: true,
      };

      expect(exportInfo.kind).toBe(ExportKind.Named);
      expect(exportInfo.wasOriginallyExported).toBe(true);
    });

    it("should support all export kinds", () => {
      const kinds = [
        ExportKind.NotExported,
        ExportKind.Named,
        ExportKind.NamedAndDefault,
        ExportKind.Default,
        ExportKind.DefaultOnly,
        ExportKind.Equals,
      ];

      for (const kind of kinds) {
        const exportInfo = {
          kind,
          wasOriginallyExported: false,
        };
        expect(exportInfo.kind).toBe(kind);
      }
    });
  });

  describe("BundleTypesOptions interface", () => {
    it("should accept various bundling options", () => {
      const options = {
        entry: "src/index.ts",
        inlinedLibraries: ["lib1", "lib2"],
        allowedTypesLibraries: ["node", "react"],
        importedLibraries: ["lodash"],
        inlineDeclareGlobals: true,
        inlineDeclareExternals: false,
        exportReferencedTypes: true,
        noBanner: false,
        sortNodes: true,
        umdModuleName: "MyLib",
        respectPreserveConstEnum: true,
      };

      expect(options.entry).toBe("src/index.ts");
      expect(options.inlinedLibraries.length).toBe(2);
      expect(options.exportReferencedTypes).toBe(true);
    });
  });
});
