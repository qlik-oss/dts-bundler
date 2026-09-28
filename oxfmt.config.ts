import config from "@qlik/oxfmt-config";
import { defineConfig } from "oxfmt";

export default defineConfig({
  ...config,
  // sortImports: true,
  // jsdoc: {
  //   commentLineStrategy: "keep",
  // },
  ignorePatterns: [
    "**/__snapshots__",
    "pnpm-lock.yaml",
    "test/fixtures/**/expected.d.ts",
    "test/fixtures/import-type-from-deps/module-with-import-type.d.ts",
    "test/fixtures/export-wrapped-with-namespace/input.ts",
    "test/fixtures/more-tree-shaking/theme.ts",
    "MOVING_A_TEST_CASE.md",
  ],
});
