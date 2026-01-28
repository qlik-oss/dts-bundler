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
import { bundleDts } from "../src/index";
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

    it("should handle import * from local modules", () => {
      const { expected, result } = runTestCase("import-star-from-local-module");
      expect(result).toBe(expected);
    });

    it("should handle default imports from node_modules", () => {
      const { expected, result } = runTestCase("import-default-from-node-modules");
      expect(result).toBe(expected);
    });

    it("should handle mixed ES and CommonJS imports", () => {
      const { expected, result } = runTestCase("mixed-imports");
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

    it("should not inline declare global when disabled", () => {
      const { expected, result } = runTestCase("dont-inline-declare-global", { inlineDeclareGlobals: false });
      expect(result).toBe(expected);
    });

    it("should inline declare global when enabled", () => {
      const { expected, result } = runTestCase("inline-declare-global", { inlineDeclareGlobals: true });
      expect(result).toBe(expected);
    });
  });

  describe("Configuration Options", () => {
    it("should add banner when noBanner is false", () => {
      const { expected, result } = runTestCase("banner", { noBanner: false });
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

    it("should handle labelled tuples", () => {
      const { expected, result } = runTestCase("labelled-tuples");
      expect(result).toBe(expected);
    });

    it("should handle keyof typeof variable type", () => {
      const { expected, result } = runTestCase("export-keyof-typeof-var-type");
      expect(result).toBe(expected);
    });
  });

  describe("Name Resolution", () => {
    it("should handle external types with same name from different packages", () => {
      const { expected, result } = runTestCase("external-name-conflicts", { inlinedLibraries: ["@myorg/lib"] });
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
      expect(() => bundleDts({})).toThrow("required");
    });

    it("should throw error when entry file does not exist", () => {
      expect(() => bundleDts({ entry: "nonexistent.ts" })).toThrow("does not exist");
    });
  });

  describe("Save JSDoc comments", () => {
    it("should keep jsdoc comments in the output", () => {
      const { expected, result } = runTestCase("save-jsdoc");
      expect(result).toBe(expected);
    });
  });
});
