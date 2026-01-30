# TypeScript Declaration Bundler

A tool for bundling TypeScript files (`.ts` and/or `.d.ts`) by inlining local imports and optionally inlining types from specified npm packages. Works both as a **CLI tool** and as a **library** you can import in your Node.js projects.

## Features

### Core Bundling

- 🎯 **Inline local imports** — Automatically resolves and inlines all relative imports (`./` or `../`)
- 📦 **Selective library inlining** — Optionally inline types from specific npm packages
- 🔄 **External import consolidation** — Keeps external imports at the top of the bundled file
- 🎨 **Type-only import handling** — Properly handles `import type` statements
- 🔁 **Export re-export resolution** — Resolves `export * from` statements

### Advanced Capabilities

- 🧩 **Ambient module inlining** — Optionally inline `declare module "..."` blocks for external modules
- 🌐 **`declare global` support** — Control whether `declare global` blocks are inlined or preserved
- 🔀 **Declaration merging** — Correctly handles TypeScript declaration merging scenarios
- 🌳 **Tree shaking** — Removes unused declarations from the output
- 🏷️ **Name collision resolution** — Automatically resolves naming conflicts across files

### Output Control

- 📛 **UMD module name** — Generate UMD-compatible output with `export as namespace`
- 🔤 **Sorted output** — Optionally sort declarations alphabetically for consistent diffs
- 📜 **Banner control** — Include or exclude the generated banner comment
- 🔒 **Preserve const enums** — Respect `preserveConstEnums` compiler option
- 📚 **Triple-slash references** — Automatically add `/// <reference types="..." />` for `@types/*` packages

### Developer Experience

- 🛠️ **Dual usage** — Use as CLI tool or import as a library
- ✨ **Full TypeScript support** — Complete type definitions included
- ⚡ **Fast** — Built on the TypeScript compiler API for accurate and efficient parsing

## Installation

```bash
npm install @qlik/dts-bundler
# or
pnpm add @qlik/dts-bundler
# or
yarn add @qlik/dts-bundler
```

## Usage

### As a Library

```typescript
import { bundleTypes } from "@qlik/dts-bundler";
import fs from "fs";

// Basic usage - returns bundled content as string
const bundledContent = bundleTypes({
  entry: "./src/types.ts",
});

// Write to file
fs.writeFileSync("./dist/bundle.d.ts", bundledContent);

// With inlined libraries
const bundledWithLibs = bundleTypes({
  entry: "./src/types.ts",
  inlinedLibraries: ["@my-org/types", "some-package"],
  inlineDeclareExternals: true,
});

fs.writeFileSync("./dist/bundle.d.ts", bundledWithLibs);
```

### As a CLI Tool

```bash
bundle-types -e < entry > -o < output > [-i < inlinedLibraries > ]
```

#### CLI Options

- `-e, --entry <file>` - **Required**: Entry TypeScript file to bundle
- `-o, --output <file>` - **Required**: Output file path for bundled types
- `-i, --inlinedLibraries <list>` - **Optional**: Comma-separated list of npm packages to inline
- `-h, --help` - Show help message

#### CLI Examples

**Basic usage** (inline only local imports):

```bash
bundle-types -e ./src/types.ts -o ./dist/bundle.d.ts
```

**With npm package inlining**:

```bash
bundle-types \
  -e ./src/types.ts \
  -o ./dist/bundle.d.ts \
  -i @my-org/types-pkg,@another/types-pkg
```

**Using npm scripts** (add to `package.json`):

```json
{
  "scripts": {
    "bundle-types": "bundle-types -e ./src/types.ts -o ./dist/bundle.d.ts"
  }
}
```

Then run:

```bash
npm run bundle-types
```

## Real-World Use Cases

### Use Case 1: Publishing a Library

When publishing a library, bundle internal types but keep framework types external:

```typescript
import { bundleTypes } from "@qlik/dts-bundler";
import fs from "fs";

const bundled = bundleTypes({
  entry: "./src/index.ts",
  inlinedLibraries: ["@my-company/internal-types"],
});

fs.writeFileSync("./dist/index.d.ts", bundled);
```

### Use Case 2: Monorepo Type Sharing

In a monorepo, inline types from your own packages:

```bash
bundle-types \
  -e ./src/types.ts \
  -o ./dist/types.d.ts \
  -i @myorg/pkg-a,@myorg/pkg-b,@myorg/pkg-c
```

### Use Case 3: Single File Distribution

Create a single file with all types for easy distribution:

```typescript
import { bundleTypes } from "@qlik/dts-bundler";
import fs from "fs";

const bundled = bundleTypes({
  entry: "./src/api.types.ts",
});

fs.writeFileSync("./api-complete.d.ts", bundled);
```

### Use Case 4: Build Pipeline Integration

Integrate into your build process:

```typescript
// build.js
import { bundleTypes } from "@qlik/dts-bundler";
import fs from "fs";

async function build() {
  // ... other build steps

  const bundled = bundleTypes({
    entry: "./src/public-api.ts",
  });

  fs.writeFileSync("./dist/index.d.ts", bundled);

  console.log("✓ Types bundled!");
}

build();
```

## How It Works

The bundler performs the following steps:

1. **Parse Entry File**: Reads and parses the entry TypeScript file using the TypeScript compiler API
2. **Resolve Imports**:
   - Local imports (starting with `./` or `../`) are always resolved and inlined
   - Imports from packages in the `inlinedLibraries` list are also inlined
   - All other imports are tracked as external dependencies
3. **Recursive Processing**: Recursively processes all files that should be inlined
4. **Generate Output**:
   - External imports are consolidated and placed at the top
   - All inlined type declarations follow
   - An `export {}` statement ensures the file is treated as a module

## Example Transformation

### Input Files

**`src/types.ts`**:

```typescript
import type { ExternalType } from "@external/package";
import type { LocalType } from "./local-types";

export interface MyType extends LocalType {
  external: ExternalType;
}
```

**`src/local-types.ts`**:

```typescript
export interface LocalType {
  id: string;
  name: string;
}
```

### Output File

**`dist/bundle.d.ts`**:

```typescript
// Generated by @qlik/dts-bundler

import type { ExternalType } from "@external/package";

export interface LocalType {
  id: string;
  name: string;
}

export interface MyType extends LocalType {
  external: ExternalType;
}

export {};
```

## API Reference

For complete API documentation, see the [API Reference](docs/api.md).

### Quick Reference

#### `bundleTypes(options)`

Bundle TypeScript declaration files.

```typescript
import { bundleTypes } from "@qlik/dts-bundler";
import fs from "fs";

const bundled = bundleTypes({
  entry: "./src/types.ts",
  inlinedLibraries: ["@my-org/types"],
  inlineDeclareExternals: true,
});

fs.writeFileSync("./dist/bundle.d.ts", bundled);
```

#### Options Summary

| Option                     | Type       | Default     | Description                                     |
| -------------------------- | ---------- | ----------- | ----------------------------------------------- |
| `entry`                    | `string`   | —           | **(Required)** Entry TypeScript file path       |
| `inlinedLibraries`         | `string[]` | `[]`        | Libraries to inline into the bundle             |
| `allowedTypesLibraries`    | `string[]` | `undefined` | `@types/*` packages for triple-slash references |
| `importedLibraries`        | `string[]` | `undefined` | Libraries to keep as imports                    |
| `inlineDeclareGlobals`     | `boolean`  | `false`     | Inline `declare global` blocks                  |
| `inlineDeclareExternals`   | `boolean`  | `false`     | Inline `declare module` blocks                  |
| `exportReferencedTypes`    | `boolean`  | `false`     | Auto-export referenced types                    |
| `noBanner`                 | `boolean`  | `false`     | Exclude banner comment                          |
| `sortNodes`                | `boolean`  | `false`     | Sort declarations alphabetically                |
| `umdModuleName`            | `string`   | `undefined` | UMD module name (`export as namespace`)         |
| `respectPreserveConstEnum` | `boolean`  | `false`     | Respect tsconfig `preserveConstEnums`           |

See the [full API documentation](docs/api.md) for detailed descriptions and examples of each option.

## Tips & Best Practices

1. **Multiple libraries**: Separate with commas (CLI) or use an array (library)

   ```bash
   # CLI
   -i @org/pkg1,@org/pkg2,@org/pkg3
   ```

   ```typescript
   // Library
   inlinedLibraries: ["@org/pkg1", "@org/pkg2", "@org/pkg3"];
   ```

2. **Scoped packages**: Include the full scope

   ```typescript
   inlinedLibraries: ["@mycompany/types", "@anothercompany/utils"];
   ```

3. **Package subpaths**: Specify the exact import path

   ```typescript
   inlinedLibraries: ["@mycompany/types/dist/api"];
   ```

4. **Check the output**: Always verify the generated file matches your expectations

   ```bash
   bundle-types -e ./src/types.ts -o ./dist/bundle.d.ts
   head -50 ./dist/bundle.d.ts
   ```

## Limitations

- Only handles TypeScript files (`.ts`, `.tsx`, `.mts`, `.cts`, `.d.ts`, `.d.mts`, `.d.cts`)
- Does not handle runtime JavaScript code (this is a type bundler)
- Assumes all imported files exist and are accessible
- Does not perform type checking (use `tsc` for that)
- Circular dependencies may cause issues in complex scenarios

## Requirements

- **Node.js** >= 20
- **TypeScript** ^5.9.3 (included as a dependency)

## Troubleshooting

### "Could not resolve import" warning

This warning appears when the bundler cannot find an imported file. Check:

- The file path is correct
- The file has a `.ts`, `.tsx`, or `.d.ts` extension
- The file exists at the resolved location

### Duplicate type definitions

If you see duplicate types in the output, ensure:

- You're not importing the same file through multiple paths
- Your import paths are consistent (absolute vs relative)

### Process exits unexpectedly

If the entry file doesn't exist, the process will exit with code 1. Ensure:

- The entry file path is correct
- The file exists before running the bundler

## Development

### Running Tests

The project uses [vitest](https://vitest.dev/) for testing with snapshot testing for output verification.

```bash
# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Update snapshots when output changes are intentional
pnpm test:update
```

### Snapshot Testing

Tests use snapshots to verify bundler output. If you make changes that affect the generated output:

1. Run `pnpm test` to see the diff
2. Review the changes carefully
3. If correct, run `pnpm test:update` to update snapshots
4. Commit the updated snapshot files

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Related

- [API Reference](docs/api.md) — Complete API documentation
- [TypeScript Handbook: Declaration Files](https://www.typescriptlang.org/docs/handbook/declaration-files/introduction.html)

## License

ISC
