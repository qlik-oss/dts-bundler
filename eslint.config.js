// @ts-check
import qlik from "@qlik/eslint-config";

export default qlik.compose(
  // ignored files
  { ignores: ["node_modules", "dts-bundle-generator", "**/test/fixtures", "**/test/__snapshots__", "dist"] },
  ...qlik.configs.esm,
  {
    rules: {
      "@typescript-eslint/method-signature-style": "off",
      "max-classes-per-file": "off",
      "no-continue": "off",
      "class-methods-use-this": "off",
    },
  },
);
