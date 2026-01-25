import { defineConfig } from "tsdown";

export default defineConfig({
  outExtensions: () => ({ js: ".js" }),
  format: "esm",
  entry: ["src/index.ts"],
});
