import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { bundleDts } from "../index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDir = path.join(__dirname, "fixtures");

describe("TypeScript Declaration Bundler", () => {
  it("should bundle basic relative imports", async () => {
    const content = bundleDts({
      entry: path.join(testDir, "basic-imports.ts"),
    });

    await expect(content).toMatchFileSnapshot("./__snapshots__/basic-relative-imports.d.ts");
    expect(content).toContain("interface Helper");
    expect(content).toContain("interface User");
    expect(content).not.toContain("import { Helper }");
  });

  it("should preserve external imports", async () => {
    const output = bundleDts({
      entry: path.join(testDir, "external-imports.ts"),
    });

    await expect(output).toMatchFileSnapshot("./__snapshots__/preserve-external-imports.d.ts");
    expect(output).toContain('from "external-package"');
    expect(output).toContain('from "another-package"');
    expect(output).toContain("interface MyType");
  });

  it("should inline specified libraries", async () => {
    const output = bundleDts({
      entry: path.join(testDir, "inline-libraries.ts"),
      inlinedLibraries: ["@myorg/lib"],
    });

    await expect(output).toMatchFileSnapshot("./__snapshots__/inline-specified-libraries.d.ts");
    expect(output).not.toContain('from "@myorg/lib"');
    expect(output).toContain('from "other-lib"');
    expect(output).toContain("LocalHelper");
  });

  it("should throw error when entry is missing", () => {
    expect(() => bundleDts({})).toThrow("required");
  });

  it("should throw error when entry file does not exist", () => {
    expect(() => bundleDts({ entry: "nonexistent.ts" })).toThrow("does not exist");
  });

  it("should handle multiple nested imports", async () => {
    const output = bundleDts({
      entry: path.join(testDir, "nested-imports.ts"),
    });

    await expect(output).toMatchFileSnapshot("./__snapshots__/multiple-nested-imports.d.ts");
    expect(output).toContain("interface Level1");
    expect(output).toContain("interface Level2Type");
    expect(output).toContain("interface Level3Type");
    expect(output).not.toContain("./level2");
    expect(output).not.toContain("./level3");
  });

  it("should handle type aliases", async () => {
    const output = bundleDts({
      entry: path.join(testDir, "type-aliases.ts"),
    });

    await expect(output).toMatchFileSnapshot("./__snapshots__/type-aliases.d.ts");
    expect(output).toContain("type Status");
    expect(output).toContain("type Result");
    expect(output).toContain("type UserStatus");
    expect(output).toContain("type ApiResponse");
    expect(output).toContain("interface Config");
    expect(output).not.toContain("./typeAliases");
  });

  it("should tree shake and remove unused types", async () => {
    const output = bundleDts({
      entry: path.join(testDir, "tree-shaking.ts"),
    });

    await expect(output).toMatchFileSnapshot("./__snapshots__/tree-shaking.d.ts");
    expect(output).toContain("interface UsedType");
    expect(output).not.toContain("interface UnusedType");
    expect(output).not.toContain("interface AnotherUnusedType");
  });

  it("should handle import aliases", async () => {
    const output = bundleDts({
      entry: path.join(testDir, "import-aliases.ts"),
    });

    await expect(output).toMatchFileSnapshot("./__snapshots__/import-aliases.d.ts");
    expect(output).toContain("type Status");
    expect(output).toContain("type Result");
    expect(output).toContain("type MyStatus");
    expect(output).toContain("type MyResult");
    expect(output).toContain("export type UserStatus = MyStatus");
    expect(output).toContain("export type ApiResponse<T> = MyResult<T>");
    expect(output).toContain("export type RunnerStatus = Status");
    expect(output).toContain("export type RunnerResponse<T> = Result<T>");
    expect(output).toContain("export interface Config");
  });

  it("should handle template literal types and interface extensions", async () => {
    const output = bundleDts({
      entry: path.join(testDir, "template-literals-and-extends.ts"),
    });

    await expect(output).toMatchFileSnapshot("./__snapshots__/template-literals-and-extends.d.ts");
    expect(output).toContain("type DataAttributes");
    expect(output).toContain("Record<`data-${string}`, string>"); // eslint-disable-line
    expect(output).toContain("interface MenuItemBase");
    expect(output).toContain("interface MenuItemRow");
    expect(output).toContain("export type MenuRowTypes");
    expect(output).toContain("extends DataAttributes");
    expect(output).toContain("extends MenuItemBase");
  });

  it("should handle external types with same name from different packages", async () => {
    const output = bundleDts({
      entry: path.join(testDir, "external-name-conflicts.ts"),
      inlinedLibraries: ["@myorg/lib"],
    });

    await expect(output).toMatchFileSnapshot("./__snapshots__/external-name-conflicts.d.ts");
    expect(output).toContain('from "another-package"');
    expect(output).toContain('from "external-package"');
    expect(output).toContain('from "third-package"');
    expect(output).toContain("AnotherLocalHelper");
    expect(output).toContain("AdditionalLocalHelper");
    expect(output).toContain("YetAnotherLocalHelper");
    expect(output).toContain("interface Combined");
    // Should rename conflicting Config imports
    expect(output).toContain("Config_1");
    expect(output).toContain("Config_2");
  });
});
