import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { bundleDts } from "../index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDir = path.join(__dirname, "fixtures");

describe("TypeScript Declaration Bundler", () => {
  it("should bundle basic relative imports", async () => {
    const content = bundleDts({
      entry: path.join(testDir, "input1.ts"),
    });

    await expect(content).toMatchFileSnapshot("__snapshots__/bundle1.d.ts");
    expect(content).toContain("interface Helper");
    expect(content).toContain("interface User");
    expect(content).not.toContain("import { Helper }");
  });

  it("should preserve external imports", async () => {
    const output = bundleDts({
      entry: path.join(testDir, "input2.ts"),
    });

    await expect(output).toMatchFileSnapshot("__snapshots__/bundle2.d.ts");
    expect(output).toContain('from "external-package"');
    expect(output).toContain('from "another-package"');
    expect(output).toContain("interface MyType");
  });

  it("should inline specified libraries", async () => {
    const output = bundleDts({
      entry: path.join(testDir, "input3.ts"),
      inlinedLibraries: ["@myorg/lib"],
    });

    await expect(output).toMatchFileSnapshot("__snapshots__/bundle3.d.ts");
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
      entry: path.join(testDir, "input4.ts"),
    });

    await expect(output).toMatchFileSnapshot("__snapshots__/bundle4.d.ts");
    expect(output).toContain("interface Level1");
    expect(output).toContain("interface Level2Type");
    expect(output).toContain("interface Level3Type");
    expect(output).not.toContain("./level2");
    expect(output).not.toContain("./level3");
  });

  it("should handle type aliases", async () => {
    const output = bundleDts({
      entry: path.join(testDir, "input5.ts"),
    });

    await expect(output).toMatchFileSnapshot("__snapshots__/bundle5.d.ts");
    expect(output).toContain("type Status");
    expect(output).toContain("type Result");
    expect(output).toContain("type UserStatus");
    expect(output).toContain("type ApiResponse");
    expect(output).toContain("interface Config");
    expect(output).not.toContain("./typeAliases");
  });

  it("should support output of .ts file", async () => {
    const output = bundleDts({
      entry: path.join(testDir, "input5.ts"),
    });

    await expect(output).toMatchFileSnapshot("__snapshots__/bundle6.ts");
    expect(output).toContain("type Status");
    expect(output).toContain("type Result");
    expect(output).toContain("type UserStatus");
    expect(output).toContain("type ApiResponse");
    expect(output).toContain("interface Config");
    expect(output).not.toContain("./typeAliases");
  });
});
