// @ts-check
import qlik from "@qlik/eslint-config";

export default qlik.compose(
  // ignored files
  { ignores: ["**/test/fixtures", "**/test/snapshots"] },
  ...qlik.configs.esm,
  {
    rules: {
      "@typescript-eslint/method-signature-style": "off",
    },
  },
);
