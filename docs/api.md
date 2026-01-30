# API Reference

This document provides comprehensive documentation for `@qlik/dts-bundler`, covering both the JavaScript/TypeScript API and the CLI tool.

## Table of Contents

- [JavaScript API](#javascript-api)
  - [bundleDts()](#bundledtsoptions)
  - [Options](#options)
- [CLI Reference](#cli-reference)
  - [Commands](#commands)
  - [Options](#cli-options)
  - [Examples](#cli-examples)
- [Configuration via tsconfig.json](#configuration-via-tsconfigjson)

---

## JavaScript API

### `bundleDts(options)`

Bundle TypeScript declaration files into a single output string.

```typescript
import { bundleDts } from "@qlik/dts-bundler";

const output = bundleDts(options);
```

#### Parameters

| Parameter | Type               | Description                  |
| --------- | ------------------ | ---------------------------- |
| `options` | `BundleDtsOptions` | Configuration options object |

#### Returns

`string` — The bundled TypeScript declaration content.

#### Throws

- `Error` — When `entry` option is missing
- `Error` — When entry file does not exist

#### Basic Example

```typescript
import { bundleDts } from "@qlik/dts-bundler";
import fs from "fs";

const bundled = bundleDts({
  entry: "./src/index.ts",
});

fs.writeFileSync("./dist/index.d.ts", bundled);
```

#### Advanced Example

```typescript
import { bundleDts } from "@qlik/dts-bundler";
import fs from "fs";

const bundled = bundleDts({
  entry: "./src/index.ts",
  inlinedLibraries: ["@my-org/internal-types", "@my-org/shared"],
  allowedTypesLibraries: ["node"],
  inlineDeclareGlobals: true,
  inlineDeclareExternals: true,
  sortNodes: true,
  noBanner: false,
});

fs.writeFileSync("./dist/index.d.ts", bundled);
```

---

### Options

#### `entry`

**Type:** `string`  
**Required:** Yes

The entry TypeScript file path. This is the starting point for bundling. The bundler will resolve and process all imports from this file.

```typescript
bundleDts({
  entry: "./src/types.ts",
});
```

The path can be:

- A relative path (resolved from the current working directory)
- An absolute path
- A `.ts`, `.tsx`, `.mts`, `.cts`, or `.d.ts` file

---

#### `inlinedLibraries`

**Type:** `string[]`  
**Default:** `[]`

Array of npm package names whose types should be inlined into the bundle instead of remaining as external imports.

```typescript
bundleDts({
  entry: "./src/index.ts",
  inlinedLibraries: ["@my-org/types", "@my-org/utils"],
});
```

**Use cases:**

- Bundling internal/private packages that shouldn't be dependencies
- Creating standalone type definitions
- Monorepo packages that should be flattened

**Notes:**

- Use the full package name including scope (e.g., `@scope/package`)
- Subpaths are supported (e.g., `@scope/package/submodule`)

---

#### `allowedTypesLibraries`

**Type:** `string[]`  
**Default:** `undefined`

Array of `@types/*` package names that should be referenced via triple-slash directives instead of being inlined or imported.

```typescript
bundleDts({
  entry: "./src/index.ts",
  allowedTypesLibraries: ["node", "react"],
});
```

**Output includes:**

```typescript
/// <reference types="node" />
/// <reference types="react" />
```

**Use cases:**

- When consumers should install `@types/*` packages separately
- For common environment types like `@types/node`

---

#### `importedLibraries`

**Type:** `string[]`  
**Default:** `undefined`

Array of library names that should explicitly remain as regular imports in the output, regardless of other settings.

```typescript
bundleDts({
  entry: "./src/index.ts",
  importedLibraries: ["react", "lodash"],
});
```

**Use cases:**

- Ensuring specific dependencies remain as peer dependencies
- Preventing accidental inlining of large libraries

---

#### `inlineDeclareGlobals`

**Type:** `boolean`  
**Default:** `false`

Whether to inline `declare global { ... }` blocks from imported files into the bundle.

```typescript
bundleDts({
  entry: "./src/index.ts",
  inlineDeclareGlobals: true,
});
```

**When `true`:** Global augmentations from all processed files are included in the output.

**When `false`:** Global declarations are omitted (they may need to be in a separate file).

**Example input:**

```typescript
// In an imported file
declare global {
  interface Window {
    myApp: MyAppType;
  }
}
```

---

#### `inlineDeclareExternals`

**Type:** `boolean`  
**Default:** `false`

Whether to inline `declare module "..."` blocks for external modules.

```typescript
bundleDts({
  entry: "./src/index.ts",
  inlineDeclareExternals: true,
});
```

**When `true`:** Module augmentations for external packages are included.

**Example input:**

```typescript
// In an imported file
declare module "express" {
  interface Request {
    user?: User;
  }
}
```

---

#### `exportReferencedTypes`

**Type:** `boolean`  
**Default:** `false`

Whether to automatically export types that are referenced by exported declarations but not explicitly exported themselves.

```typescript
bundleDts({
  entry: "./src/index.ts",
  exportReferencedTypes: true,
});
```

**Example:**

```typescript
// Input
interface InternalType {
  id: string;
}
export interface PublicType {
  data: InternalType;
}

// Output with exportReferencedTypes: true
export interface InternalType {
  id: string;
}
export interface PublicType {
  data: InternalType;
}

// Output with exportReferencedTypes: false
interface InternalType {
  id: string;
}
export interface PublicType {
  data: InternalType;
}
```

---

#### `noBanner`

**Type:** `boolean`  
**Default:** `false`

Whether to exclude the generated banner comment from the output.

```typescript
bundleDts({
  entry: "./src/index.ts",
  noBanner: true,
});
```

**When `false` (default):** Output includes a banner:

```typescript
// Generated by @qlik/dts-bundler
```

**When `true`:** No banner is added.

---

#### `sortNodes`

**Type:** `boolean`  
**Default:** `false`

Whether to sort declarations alphabetically in the output.

```typescript
bundleDts({
  entry: "./src/index.ts",
  sortNodes: true,
});
```

**Use cases:**

- Consistent output regardless of import order
- Easier diffing between versions
- Alphabetical organization preference

---

#### `umdModuleName`

**Type:** `string`  
**Default:** `undefined`

UMD module name to include in the output. When specified, generates a UMD-compatible declaration.

```typescript
bundleDts({
  entry: "./src/index.ts",
  umdModuleName: "MyLibrary",
});
```

**Output includes:**

```typescript
export as namespace MyLibrary;
```

---

#### `respectPreserveConstEnum`

**Type:** `boolean`  
**Default:** `false`

Whether to respect the `preserveConstEnums` setting from tsconfig.json.

```typescript
bundleDts({
  entry: "./src/index.ts",
  respectPreserveConstEnum: true,
});
```

**When `true`:** If tsconfig.json has `"preserveConstEnums": true`, const enums are preserved as-is.

**When `false`:** Const enums may be inlined regardless of tsconfig settings.

---

## CLI Reference

The CLI tool is available as `bundle-types` after installation.

### Commands

```bash
bundle-types [options]
```

### CLI Options

| Option               | Alias | Type     | Required | Description                                    |
| -------------------- | ----- | -------- | -------- | ---------------------------------------------- |
| `--entry`            | `-e`  | `string` | Yes      | Entry TypeScript file to bundle                |
| `--output`           | `-o`  | `string` | Yes      | Output file path for bundled types             |
| `--inlinedLibraries` | `-i`  | `string` | No       | Comma-separated list of npm packages to inline |
| `--help`             | `-h`  | —        | No       | Show help message                              |

### CLI Examples

#### Basic Usage

Bundle local imports only:

```bash
bundle-types -e ./src/types.ts -o ./dist/bundle.d.ts
```

#### With Inlined Libraries

Bundle with specific npm packages inlined:

```bash
bundle-types \
  -e ./src/types.ts \
  -o ./dist/bundle.d.ts \
  -i @my-org/types,@my-org/utils
```

#### Multiple Libraries

Separate multiple libraries with commas (no spaces):

```bash
bundle-types -e ./src/index.ts -o ./dist/index.d.ts -i pkg1,pkg2,@scope/pkg3
```

#### In npm Scripts

Add to your `package.json`:

```json
{
  "scripts": {
    "build:types": "bundle-types -e ./src/index.ts -o ./dist/index.d.ts"
  }
}
```

Then run:

```bash
npm run build:types
```

#### With Build Pipeline

Chain with other build commands:

```bash
tsc && bundle-types -e ./src/index.ts -o ./dist/index.d.ts
```

---

## Configuration via tsconfig.json

The bundler automatically reads and respects your `tsconfig.json` settings:

- **Path mappings** (`paths`, `baseUrl`) — Resolved correctly
- **Module resolution** (`moduleResolution`) — Respected
- **Strict mode** settings — Preserved in output
- **`preserveConstEnums`** — Respected when `respectPreserveConstEnum` is enabled

The bundler looks for `tsconfig.json` in the directory of the entry file, walking up the directory tree if needed.

---

## Type Definitions

### `BundleDtsOptions`

```typescript
interface BundleDtsOptions {
  /** Entry TypeScript file path (required) */
  entry: string;

  /** Array of library names to inline */
  inlinedLibraries?: string[];

  /** @types libraries to reference via triple-slash directives */
  allowedTypesLibraries?: string[];

  /** Libraries that should remain as regular imports */
  importedLibraries?: string[];

  /** Whether to inline declare global blocks */
  inlineDeclareGlobals?: boolean;

  /** Whether to inline declare module blocks for external modules */
  inlineDeclareExternals?: boolean;

  /** Whether to export referenced types automatically */
  exportReferencedTypes?: boolean;

  /** Whether to exclude the banner comment */
  noBanner?: boolean;

  /** Whether to sort nodes alphabetically */
  sortNodes?: boolean;

  /** UMD module name to output */
  umdModuleName?: string;

  /** Respect preserveConstEnums from tsconfig */
  respectPreserveConstEnum?: boolean;
}
```
