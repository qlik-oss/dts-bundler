import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { bundleTypes } from "../src/index";
import type { BundleTypesOptions } from "../src/types";

// eslint-disable-next-line @typescript-eslint/naming-convention
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDir = path.join(__dirname, "fixtures");

// make this type partial from BundleDtsOptions without entry
export type RunTestCaseOptions = Omit<Partial<BundleTypesOptions>, "entry">;

export type ExptectedResult = {
  expected: string;
  result: string;
};

/**
 * Helper function to run a test case
 * @param {string} testName - Name of the test case (folder in fixtures/)
 * @param {object} options - Options to pass to bundleTypes
 */
export function runTestCase(testName: string, options: RunTestCaseOptions = {}): ExptectedResult {
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
  const result = bundleTypes({ entry: entryFile, noBanner: true, ...options });

  // Auto-update expected files if UPDATE_EXPECTED env var is set
  if (process.env.UPDATE_EXPECTED) {
    fs.writeFileSync(expectedFile, result);
  }

  const expected = fs.readFileSync(expectedFile, "utf8");
  return { expected, result };
}
