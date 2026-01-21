// @ts-check
import qlik from "@qlik/eslint-config";

export default qlik.compose(
  // ignored files
  { ignores: ["node_modules", "**/test/fixtures", "**/test/__snapshots__"] },
  ...qlik.configs.esm,
  {
    rules: {
      "@typescript-eslint/method-signature-style": "off",
    },
  },
);
