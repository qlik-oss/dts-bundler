# 🎉 Initial Release

This is the first release of **@qlik/dts-bundler** — a tool for bundling TypeScript declaration files into a single, distributable `.d.ts` file.

## What is @qlik/dts-bundler?

`@qlik/dts-bundler` resolves and inlines local imports from your TypeScript declaration files, optionally inlines types from specified npm packages, and produces a clean, consolidated output file. It works both as a **CLI tool** and as a **library** you can import directly into your Node.js projects.

---

## ✨ Features

### Core Bundling

- **Inline local imports** — Automatically resolves and inlines all relative imports (`./` or `../`)
- **Selective library inlining** — Optionally inline types from specific npm packages via the `inlinedLibraries` option
- **External import consolidation** — Keeps external imports at the top of the bundled file
- **Type-only import handling** — Properly handles `import type` statements

### Advanced Capabilities

- **Export re-export resolution** — Resolves `export * from` statements
- **Ambient module inlining** — Optionally inline `declare module "..."` blocks for external modules
- **`declare global` support** — Control whether `declare global` blocks are inlined or preserved
- **Declaration merging** — Correctly handles TypeScript declaration merging scenarios
- **Tree shaking** — Removes unused declarations from the output
- **Name collision resolution** — Automatically resolves naming conflicts across files

### Output Control

- **UMD module name** — Generate UMD-compatible output with a custom module name
- **Sorted output** — Optionally sort declarations alphabetically
- **Banner control** — Include or exclude the generated banner comment
- **Preserve const enums** — Respect `preserveConstEnums` compiler option
- **Triple-slash references** — Automatically add `/// <reference types="..." />` for `@types/*` packages

### Dual Usage

- **CLI tool** — `bundle-types -e <entry> -o <output> [-i <libraries>]`
- **Programmatic API** — Import `bundleDts()` directly for build pipeline integration

## 🙏 Acknowledgments

This project draws inspiration from [dts-bundle-generator](https://github.com/nicolo-ribaudo/dts-bundle-generator) and aims to provide a modern, well-tested alternative for TypeScript declaration bundling.

---

## 📄 License

ISC
