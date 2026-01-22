import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { bundleDts } from "../index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDir = path.join(__dirname, "fixtures");

/**
 * Helper function to run a test case
 * @param {string} testName - Name of the test case (folder in fixtures/)
 * @param {object} options - Options to pass to bundleDts
 */
function runTestCase(testName, options = {}) {
  const fixtureDir = path.join(testDir, testName);

  // Determine entry file (check multiple extensions)
  const possibleEntries = [
    "input.ts",
    "input.mts",
    "input.cts",
    "input.d.ts",
    "index.ts",
    "index.mts",
    "index.cts",
    "index.d.ts",
  ];
  let entryFile = null;

  for (const filename of possibleEntries) {
    const candidate = path.join(fixtureDir, filename);
    if (fs.existsSync(candidate)) {
      entryFile = candidate;
      break;
    }
  }

  if (!entryFile) {
    throw new Error(`No entry file found in ${fixtureDir}`);
  }

  const expectedFile = path.join(fixtureDir, "expected.d.ts");
  const result = bundleDts({ entry: entryFile, ...options });

  // Auto-update expected files if UPDATE_EXPECTED env var is set
  if (process.env.UPDATE_EXPECTED) {
    fs.writeFileSync(expectedFile, result);
  }

  const expected = fs.readFileSync(expectedFile, "utf8");
  expect(result).toBe(expected);
}

describe("TypeScript Declaration Bundler", () => {
  describe("Core Functionality", () => {
    it("should bundle basic relative imports", () => {
      runTestCase("basic-imports");
    });

    it("should handle multiple nested imports", () => {
      runTestCase("nested-imports");
    });
  });

  describe("Import Patterns", () => {
    it("should handle import aliases", () => {
      runTestCase("import-aliases");
    });

    it.skip("should handle type-only imports from dependencies", () => {
      runTestCase("import-type-from-deps");
    });

    it.skip("should handle imports from @types packages causing reference types", () => {
      runTestCase("import-from-types-cause-reference-types");
    });

    it.skip("should handle CommonJS import = syntax", () => {
      runTestCase("import-eq");
    });

    it.skip("should handle import * from local modules", () => {
      runTestCase("import-star-from-local-module");
    });

    it.skip("should handle default imports from node_modules", () => {
      runTestCase("import-default-from-node-modules");
    });

    it.skip("should handle mixed ES and CommonJS imports", () => {
      runTestCase("mixed-imports");
    });
  });

  describe("Library Management", () => {
    it("should preserve external imports", () => {
      runTestCase("external-imports");
    });

    it("should inline specified libraries", () => {
      runTestCase("inline-libraries", { inlinedLibraries: ["@myorg/lib"] });
    });

    it.skip("should handle transitive dependency inlining", () => {
      runTestCase("inline-from-deps-transitive");
    });
  });

  describe("Export Patterns", () => {
    it.skip("should handle CommonJS export = from entry", () => {
      runTestCase("export-eq-from-entry");
    });

    it.skip("should handle default export from entry", () => {
      runTestCase("export-default-from-entry");
    });

    it.skip("should handle existing class exported as default", () => {
      runTestCase("export-default-exist-class");
    });

    it.skip("should handle namespace exports", () => {
      runTestCase("export-namespaces");
    });

    it.skip("should handle exports via global declarations", () => {
      runTestCase("export-via-global-declaration", { inlineDeclareGlobals: true });
    });

    it.skip("should handle exports with object destructuring", () => {
      runTestCase("export-object-with-destructuring");
    });

    it.skip("should handle multiple variable exports in a list", () => {
      runTestCase("export-variables-list");
    });

    it.skip("should handle default export of default export", () => {
      runTestCase("default-export-of-default-export");
    });

    it.skip("should handle exports wrapped with namespace chain", () => {
      runTestCase("export-wrapped-with-namespace-chain");
    });

    it.skip("should not export referenced types when disabled", () => {
      runTestCase("export-default-no-export-referenced-types", { exportReferencedTypes: false });
    });
  });

  describe("Re-export Patterns", () => {
    it.skip("should handle export * from (re-export star)", () => {
      runTestCase("re-export-star");
    });

    it.skip("should handle re-export as namespace", () => {
      runTestCase("re-export-as-namespace");
    });
  });

  describe("Module Formats", () => {
    it.skip("should handle .mts extension (ES modules)", () => {
      runTestCase("mts-extension");
    });

    it.skip("should handle .cts extension (CommonJS modules)", () => {
      runTestCase("cts-extension");
    });
  });

  describe("Declaration Patterns", () => {
    it.skip("should handle declare module and imports", () => {
      runTestCase("declare-module-and-imports");
    });

    it.skip("should not inline declare global when disabled", () => {
      runTestCase("dont-inline-declare-global", { inlineDeclareGlobals: false });
    });
  });

  describe("Configuration Options", () => {
    it.skip("should add banner when noBanner is false", () => {
      runTestCase("banner", { noBanner: false });
    });

    it.skip("should support UMD module name output", () => {
      runTestCase("umd-module-name", { umdModuleName: "MyUmdModule" });
    });

    it.skip("should sort nodes when sortNodes is enabled", () => {
      runTestCase("sort-nodes", { sortNodes: true });
    });
  });

  describe("Tree Shaking", () => {
    it("should tree shake and remove unused types", () => {
      runTestCase("tree-shaking");
    });
  });

  describe("TypeScript Features", () => {
    it("should handle type aliases", () => {
      runTestCase("type-aliases");
    });

    it("should handle template literal types and interface extensions", () => {
      runTestCase("template-literals-and-extends");
    });

    it.skip("should handle recursive types", () => {
      runTestCase("recursive-types");
    });

    it.skip("should handle binding patterns without initializer", () => {
      runTestCase("binding-patterns-without-initializer");
    });

    it.skip("should handle ambient re-declared types", () => {
      runTestCase("ambient-redeclare-types");
    });

    it.skip("should respect preserve const enum when enabled", () => {
      runTestCase("respect-preserve-const-enum", { respectPreserveConstEnum: true });
    });
  });

  describe("Name Resolution", () => {
    it("should handle external types with same name from different packages", () => {
      runTestCase("external-name-conflicts", { inlinedLibraries: ["@myorg/lib"] });
    });
  });

  describe("Error Handling", () => {
    it("should throw error when entry is missing", () => {
      expect(() => bundleDts({})).toThrow("required");
    });

    it("should throw error when entry file does not exist", () => {
      expect(() => bundleDts({ entry: "nonexistent.ts" })).toThrow("does not exist");
    });
  });
});
