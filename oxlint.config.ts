import { esm, vitest } from "@qlik/oxlint-config";
import { defineConfig } from "oxlint";

export default defineConfig({
  extends: [esm, vitest],
  ignorePatterns: ["node_modules/**", "dist/**", "test/fixtures/**"],
  overrides: [
    {
      files: ["src/**/*.ts"],
      rules: {
        // Keep existing mutating sorts rather than changing production behavior in this migration.
        "unicorn/no-array-sort": "off",
      },
    },
  ],
});
