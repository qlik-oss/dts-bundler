// @ts-check
import qlik from "@qlik/eslint-config";
import { defineConfig } from "eslint/config";

export default defineConfig(
  ...qlik.configs.esm,
  {
    rules: {
      "@typescript-eslint/method-signature-style": "off",
      "max-classes-per-file": "off",
      "no-continue": "off",
      "class-methods-use-this": "off",
    },
  },
  // ignored files
  {
    ignores: ["node_modules", "**/test/fixtures", "dist"],
  },
);
