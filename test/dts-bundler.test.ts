/**
 * Test Suite for TypeScript Declaration Bundler
 *
 * IMPORTANT FOR AI ASSISTANTS:
 * - Files in test/fixtures/[test-name]/expected.d.ts are immutable specifications
 * - NEVER modify expected.d.ts files to make tests pass unless it is an intended change
 * - Fix implementation code in src/ to match the expected output
 * - Always run: pnpm test && pnpm lint && pnpm check-types
 */

import { describe, expect, it } from "vitest";
import { bundleTypes } from "../src/index";
import { runTestCase } from "./run-test-case";

describe("TypeScript Declaration Bundler", () => {
  describe("Core Functionality", () => {
    it("should bundle basic relative imports", () => {
      const { expected, result } = runTestCase("basic-imports");
      expect(result).toBe(expected);
    });

    it("should handle multiple nested imports", () => {
      const { expected, result } = runTestCase("nested-imports");
      expect(result).toBe(expected);
    });
  });

  describe("Import Patterns", () => {
    it("should handle import aliases", () => {
      const { expected, result } = runTestCase("import-aliases");
      expect(result).toBe(expected);
    });

    it("should handle type-only imports from dependencies", () => {
      const { expected, result } = runTestCase("import-type-from-deps");
      expect(result).toBe(expected);
    });

    it("should inline local type-only imports", () => {
      const { expected, result } = runTestCase("local-type-imports-inline");
      expect(result).toBe(expected);
    });

    it("should handle import() type", () => {
      const { expected, result } = runTestCase("import()-type", { inlinedLibraries: ["fake-package"] });
      expect(result).toBe(expected);
    });

    it("should handle imports from @types packages causing reference types", () => {
      const { expected, result } = runTestCase("import-from-types-cause-reference-types", {
        allowedTypesLibraries: ["node", "fake-types-lib-2"],
        importedLibraries: ["events", "fake-types-lib-2.5"],
      });
      expect(result).toBe(expected);
    });

    it("should handle CommonJS import = syntax", () => {
      const { expected, result } = runTestCase("import-eq");
      expect(result).toBe(expected);
    });

    it("should handle CommonJS import with ES module interop", () => {
      const { expected, result } = runTestCase("import-eq-with-interop");
      expect(result).toBe(expected);
    });

    it("should handle import * from local modules", () => {
      const { expected, result } = runTestCase("import-star-from-local-module");
      expect(result).toBe(expected);
    });

    it("should handle namespace imports used as type qualifiers", () => {
      const { expected, result } = runTestCase("namespaced-import");
      expect(result).toBe(expected);
    });

    it("should handle default imports from node_modules", () => {
      const { expected, result } = runTestCase("import-default-from-node-modules");
      expect(result).toBe(expected);
    });

    it("should handle different default export names in project", () => {
      const { expected, result } = runTestCase("different-default-export-names-in-project");
      expect(result).toBe(expected);
    });

    it("should handle mixed ES and CommonJS imports", () => {
      const { expected, result } = runTestCase("mixed-imports");
      expect(result).toBe(expected);
    });

    it("should handle importing variables from external packages", () => {
      const { expected, result } = runTestCase("import-variables");
      expect(result).toBe(expected);
    });

    it("should handle renamed local class imports", () => {
      const { expected, result } = runTestCase("rename-local-class");
      expect(result).toBe(expected);
    });

    it("should handle several import * from one package", () => {
      const { expected, result } = runTestCase("several-import-star-from-one-package");
      expect(result).toBe(expected);
    });

    it("should handle several default imports from one package", () => {
      const { expected, result } = runTestCase("several-import-default-from-one-package");
      expect(result).toBe(expected);
    });

    it("should handle different import styles from one package", () => {
      const { expected, result } = runTestCase("import-with-different-names", {
        importedLibraries: ["fake-package", "package-with-export-eq"],
      });
      expect(result).toBe(expected);
    });

    it("should strip exports from non-exported enums", () => {
      const { expected, result } = runTestCase("strip-export-from-non-exported-enum");
      expect(result).toBe(expected);
    });

    it("should strip exports from non-exported functions", () => {
      const { expected, result } = runTestCase("strip-export-from-non-exported-function");
      expect(result).toBe(expected);
    });

    it("should handle importing from types", () => {
      const { expected, result } = runTestCase("import-from-types", { importedLibraries: ["fs", "fake-types-lib"] });
      expect(result).toBe(expected);
    });

    it("should handle export = types from npm", () => {
      const { expected, result } = runTestCase("handle-export-eq-from-npm", { allowedTypesLibraries: [] });
      expect(result).toBe(expected);
    });
  });

  describe("Library Management", () => {
    it("should preserve external imports", () => {
      const { expected, result } = runTestCase("external-imports");
      expect(result).toBe(expected);
    });

    it("should inline specified libraries", () => {
      const { expected, result } = runTestCase("inline-libraries", { inlinedLibraries: ["@myorg/lib"] });
      expect(result).toBe(expected);
    });

    it("should handle transitive dependency inlining", () => {
      const { expected, result } = runTestCase("inline-from-deps-transitive", {
        inlinedLibraries: ["fake-package", "fake-fs"],
        sortNodes: true,
      });
      expect(result).toBe(expected);
    });
  });

  describe("Export Patterns", () => {
    it("should handle CommonJS export = from entry", () => {
      const { expected, result } = runTestCase("export-eq-from-entry");
      expect(result).toBe(expected);
    });

    it("should handle default export from entry", () => {
      const { expected, result } = runTestCase("export-default-from-entry");
      expect(result).toBe(expected);
    });

    it("should handle default export from non-entry", () => {
      const { expected, result } = runTestCase("export-default-from-non-entry");
      expect(result).toBe(expected);
    });

    it("should handle existing class exported as default", () => {
      const { expected, result } = runTestCase("export-default-exist-class");
      expect(result).toBe(expected);
    });

    it("should handle default export of just declared class from entry", () => {
      const { expected, result } = runTestCase("export-default-just-declared-class-from-entry");
      expect(result).toBe(expected);
    });

    it("should handle default export of just declared functions from entry", () => {
      const { expected, result } = runTestCase("export-default-just-declared-fns-from-entry");
      expect(result).toBe(expected);
    });

    it("should handle namespace exports", () => {
      const { expected, result } = runTestCase("export-namespaces");
      expect(result).toBe(expected);
    });

    it("should handle exports via global declarations", () => {
      const { expected, result } = runTestCase("export-via-global-declaration", { inlineDeclareGlobals: true });
      expect(result).toBe(expected);
    });

    it("should handle exports with object destructuring", () => {
      const { expected, result } = runTestCase("export-object-with-destructuring");
      expect(result).toBe(expected);
    });

    it("should handle multiple variable exports in a list", () => {
      const { expected, result } = runTestCase("export-variables-list");
      expect(result).toBe(expected);
    });

    it("should handle default export of default export", () => {
      const { expected, result } = runTestCase("default-export-of-default-export");
      expect(result).toBe(expected);
    });

    it("should handle default export of unnamed statements", () => {
      const { expected, result } = runTestCase("export-default-unnamed-statement");
      expect(result).toBe(expected);
    });

    it("should handle exports wrapped with namespace chain", () => {
      const { expected, result } = runTestCase("export-wrapped-with-namespace-chain", { exportReferencedTypes: true });
      expect(result).toBe(expected);
    });

    it("should handle exports wrapped with namespace chain via imports", () => {
      const { expected, result } = runTestCase("export-wrapped-with-namespace-chain-but-via-imports", {
        exportReferencedTypes: false,
      });
      expect(result).toBe(expected);
    });

    it("should handle exports wrapped with namespace", () => {
      const { expected, result } = runTestCase("export-wrapped-with-namespace", { exportReferencedTypes: false });
      expect(result).toBe(expected);
    });

    it("should handle export declaration merging", () => {
      const { expected, result } = runTestCase("export-declaration-merging", { exportReferencedTypes: false });
      expect(result).toBe(expected);
    });

    it("should not export referenced types when disabled", () => {
      const { expected, result } = runTestCase("export-default-no-export-referenced-types", {
        exportReferencedTypes: false,
      });
      expect(result).toBe(expected);
    });
  });

  describe("Re-export Patterns", () => {
    it("should handle export * from (re-export star)", () => {
      const { expected, result } = runTestCase("re-export-star");
      expect(result).toBe(expected);
    });

    it("should handle re-export star with selection", () => {
      const { expected, result } = runTestCase("re-export-star-with-selection");
      expect(result).toBe(expected);
    });

    it("should handle re-export as namespace", () => {
      const { expected, result } = runTestCase("re-export-as-namespace");
      expect(result).toBe(expected);
    });

    it("should handle re-export as default of unnamed class", () => {
      const { expected, result } = runTestCase("re-export-as-default-of-unnamed-class");
      expect(result).toBe(expected);
    });

    it("should handle re-export default export with same name", () => {
      const { expected, result } = runTestCase("re-export-default-export-with-same-name");
      expect(result).toBe(expected);
    });

    it("should handle re-export as named and default", () => {
      const { expected, result } = runTestCase("re-export-as-named-and-default");
      expect(result).toBe(expected);
    });

    it("should handle double re-export from node_modules", () => {
      const { expected, result } = runTestCase("double-re-export-from-node_modules");
      expect(result).toBe(expected);
    });

    it("should handle re-exporting members from star", () => {
      const { expected, result } = runTestCase("re-export-star-member");
      expect(result).toBe(expected);
    });

    it("should handle re-export without statements (namespace re-export)", () => {
      const { expected, result } = runTestCase("re-export-without-statements");
      expect(result).toBe(expected);
    });
  });

  describe("Module Formats", () => {
    it("should handle .mts extension (ES modules)", () => {
      const { expected, result } = runTestCase("mts-extension");
      expect(result).toBe(expected);
    });

    it("should handle .cts extension (CommonJS modules)", () => {
      const { expected, result } = runTestCase("cts-extension");
      expect(result).toBe(expected);
    });

    it("allow arbitrary extensions (.json)", () => {
      const { expected, result } = runTestCase("allow-arbitrary-extensions");
      expect(result).toBe(expected);
    });
  });

  describe("Declaration Patterns", () => {
    it("should handle declare module and imports", () => {
      const { expected, result } = runTestCase("declare-module-and-imports", { inlineDeclareExternals: true });
      expect(result).toBe(expected);
    });

    it("should handle unknown module declarations", () => {
      const { expected, result } = runTestCase("declare-unknown-modules", { inlineDeclareExternals: true });
      expect(result).toBe(expected);
    });

    it("should handle declare module in internal files", () => {
      const { expected, result } = runTestCase("declare-module-in-internal-files", { inlineDeclareExternals: true });
      expect(result).toBe(expected);
    });

    it("should handle internal modules without inlining externals", () => {
      const { expected, result } = runTestCase("modules-in-internal-files-without-inline-declare-globals");
      expect(result).toBe(expected);
    });

    it("should not inline external modules in internal files", () => {
      const { expected, result } = runTestCase("dont-inline-declare-extenal-modules-in-internal-files");
      expect(result).toBe(expected);
    });

    it("should not inline declare global when disabled", () => {
      const { expected, result } = runTestCase("dont-inline-declare-global", { inlineDeclareGlobals: false });
      expect(result).toBe(expected);
    });

    it("should preserve declare global when enabled (simple case)", () => {
      const { expected, result } = runTestCase("declare-global-preserved", { inlineDeclareGlobals: true });
      expect(result).toBe(expected);
    });

    it("should inline declare global when enabled", () => {
      const { expected, result } = runTestCase("inline-declare-global", { inlineDeclareGlobals: true });
      expect(result).toBe(expected);
    });

    it("should inline local types used in declare global", () => {
      const { expected, result } = runTestCase("declare-global-with-local-imports", {
        inlineDeclareGlobals: true,
      });
      expect(result).toBe(expected);
    });

    it("should inline declared globals from imports", () => {
      const { expected, result } = runTestCase("inline-declare-global-from-imports", {
        inlineDeclareGlobals: true,
      });
      expect(result).toBe(expected);
    });

    it("should handle top-level declarations", () => {
      const { expected, result } = runTestCase("top-level-declarations");
      expect(result).toBe(expected);
    });
  });

  describe("Configuration Options", () => {
    it("should add banner when noBanner is false", () => {
      const { expected, result } = runTestCase("banner", { noBanner: false });
      expect(result).toBe(expected);
    });

    it("should disable non-direct exports when configured", () => {
      const { expected, result } = runTestCase("disable-non-direct-exports", { exportReferencedTypes: false });
      expect(result).toBe(expected);
    });

    it("should support UMD module name output", () => {
      const { expected, result } = runTestCase("umd-module-name", { umdModuleName: "MyUmdModule" });
      expect(result).toBe(expected);
    });

    it("should sort nodes when sortNodes is enabled", () => {
      const { expected, result } = runTestCase("sort-nodes", { sortNodes: true });
      expect(result).toBe(expected);
    });
  });

  describe("Tree Shaking", () => {
    it("should tree shake and remove unused types", () => {
      const { expected, result } = runTestCase("tree-shaking");
      expect(result).toBe(expected);
    });

    it("should tree shake unused types in simple case", () => {
      const { expected, result } = runTestCase("simple-tree-shaking");
      expect(result).toBe(expected);
    });
  });

  describe("TypeScript Features", () => {
    it("should handle type aliases", () => {
      const { expected, result } = runTestCase("type-aliases");
      expect(result).toBe(expected);
    });

    it("should handle template literal types and interface extensions", () => {
      const { expected, result } = runTestCase("template-literals-and-extends");
      expect(result).toBe(expected);
    });

    it("should handle recursive types", () => {
      const { expected, result } = runTestCase("recursive-types");
      expect(result).toBe(expected);
    });

    it("should handle binding patterns without initializer", () => {
      const { expected, result } = runTestCase("binding-patterns-without-initializer");
      expect(result).toBe(expected);
    });

    it("should handle ambient re-declared types", () => {
      const { expected, result } = runTestCase("ambient-redeclare-types");
      expect(result).toBe(expected);
    });

    it("should respect preserve const enum when enabled", () => {
      const { expected, result } = runTestCase("respect-preserve-const-enum", { respectPreserveConstEnum: true });
      expect(result).toBe(expected);
    });

    it("should handle extending other modules", () => {
      const { expected, result } = runTestCase("extend-other-module", { inlineDeclareExternals: true });
      expect(result).toBe(expected);
    });

    it("should handle globalThis references", () => {
      const { expected, result } = runTestCase("globalThis");
      expect(result).toBe(expected);
    });

    it("should handle function parameter destructuring with defaults", () => {
      const { expected, result } = runTestCase("primitive-generation");
      expect(result).toBe(expected);
    });

    it("should handle labelled tuples", () => {
      const { expected, result } = runTestCase("labelled-tuples");
      expect(result).toBe(expected);
    });

    it("should handle keyof typeof variable type", () => {
      const { expected, result } = runTestCase("export-keyof-typeof-var-type");
      expect(result).toBe(expected);
    });

    it("should handle non-exported abstract class as base", () => {
      const { expected, result } = runTestCase("non-exported-abstract-class");
      expect(result).toBe(expected);
    });

    it("should handle merged namespaces across files", () => {
      const { expected, result } = runTestCase("merged-namespaces");
      expect(result).toBe(expected);
    });
  });

  describe("Name Resolution", () => {
    it("should handle external types with same name from different packages", () => {
      const { expected, result } = runTestCase("external-name-conflicts", { inlinedLibraries: ["@myorg/lib"] });
      expect(result).toBe(expected);
    });

    it("should handle renaming imported externals", () => {
      const { expected, result } = runTestCase("rename-imports");
      expect(result).toBe(expected);
    });

    it("should handle name collisions across files", () => {
      const { expected, result } = runTestCase("names-collision-across-files", { noBanner: true });
      expect(result).toBe(expected);
    });

    it("should handle name collisions with globals", () => {
      const { expected, result } = runTestCase("names-collision-with-globals");
      expect(result).toBe(expected);
    });
  });

  describe("Error Handling", () => {
    it("should throw error when entry is missing", () => {
      // @ts-expect-error - testing missing entry
      expect(() => bundleTypes({})).toThrow("required");
    });

    it("should throw error when entry file does not exist", () => {
      expect(() => bundleTypes({ entry: "nonexistent.ts" })).toThrow("does not exist");
    });
  });

  describe("Save JSDoc comments", () => {
    it("should keep jsdoc comments in the output", () => {
      const { expected, result } = runTestCase("save-jsdoc");
      expect(result).toBe(expected);
    });
  });
});
