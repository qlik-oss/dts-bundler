# Plan: Port dts-bundle-generator Features to Modern TypeScript Bundler

Complete implementation of 30 skipped tests by adding missing export/import patterns, declaration support, configuration options, and module resolution capabilities. The work follows a systematic approach: validate tests, categorize by feature, then implement incrementally while using the original dts-bundle-generator codebase as reference.

## Steps

### 1. Refactor current index.js into modular structure

Modularize the existing monolithic `index.js` into focused modules within a new `src/` directory. Separate concerns for export handling, import resolution, declaration parsing, configuration management, and output generation. This will enhance maintainability and clarity. In the end, the `src/` folder should contain multiple TypeScript files instead of a single JavaScript file and `index.js` and `index.d.ts` should be removed. Make sure the current working tests still pass after refactoring.

**Suggested module structure:**

- `src/index.ts` - Main entry point, exports `bundleDts()` function
- `src/types.ts` - TypeScript interfaces and type definitions (TypeDeclaration, ExternalImport, etc.)
- `src/registry.ts` - TypeRegistry class
- `src/file-collector.ts` - FileCollector class with module resolution
- `src/declaration-parser.ts` - DeclarationParser class
- `src/dependency-analyzer.ts` - DependencyAnalyzer class
- `src/name-normalizer.ts` - NameNormalizer class
- `src/tree-shaker.ts` - TreeShaker class
- `src/output-generator.ts` - OutputGenerator class

**Mapping current classes to modules:**

- Keep existing class structure but split into separate files
- Preserve the 8-phase architecture (Type System → Registry → Collection → Parsing → Analysis → Normalization → Tree Shaking → Output)
- Ensure each class can be independently tested
- Create `src/index.ts` that imports and orchestrates all phases

**Validation:** Run `pnpm test` after refactoring to ensure all 12 passing tests still pass before proceeding to step 2.

### 2. Audit and validate skipped tests

Review all 30 skipped test fixtures against original [dts-bundle-generator/tests/e2e/test-cases](dts-bundle-generator/tests/e2e/test-cases) with their [config.ts](dts-bundle-generator/tests/e2e/test-cases/test-case-config.ts) files to confirm expected outputs match their configurations; fix any discrepancies in [test/fixtures](test/fixtures). If a test case seems invalid or outdated, adjust the test case to reflect a valid scenario while preserving the original intent. Stop the execution and ask user for approval before proceeding. Document any changes made for clarity.

### 3 Identify initial proof-of-concept tests

Before implementing complex export patterns, identify 3-5 simplest tests to tackle first:

**Recommended starter tests:**

- `banner` (Category F) - Simple configuration option, no AST changes
- `sort-nodes` (Category F) - Output transformation only
- `mts-extension` (Category D) - File resolution enhancement
- `cts-extension` (Category D) - File resolution enhancement
- `recursive-types` (Category G) - May already work with current implementation

These tests validate the refactored architecture works correctly and build confidence before tackling complex features.

### 4. Implement Category A: Export patterns (10 tests)

Add support for `export =`, `export default`, `export *`, `export * as`, variable exports, destructuring exports, and namespace exports; implement `exportReferencedTypes` option; reference [dts-bundle-generator/src/bundle-generator.ts](dts-bundle-generator/src/bundle-generator.ts#L206-L560) for export statement handling.

### 5. Implement Category B: Import patterns (7 tests)

Add `import = require()`, default imports from locals, `import *` namespace handling, mixed import styles, @types detection with triple-slash directives, and transitive dependency resolution; reference [dts-bundle-generator/src/module-info.ts](dts-bundle-generator/src/module-info.ts) for module type detection.

### 6. Implement Category C+D+E: Re-exports, module formats, declarations (6 tests)

Add `export *` and `export * as` re-exports, .mts/.cts extension resolution, `declare module` and `declare global` statements with `inlineDeclareGlobals` option; reference [dts-bundle-generator/src/bundle-generator.ts](dts-bundle-generator/src/bundle-generator.ts) for module augmentation handling.

### 7. Implement Category F+G: Configuration and TypeScript features (7 tests)

Add `sortNodes`, `umdModuleName`, `noBanner`, `respectPreserveConstEnum` options plus support for recursive types, binding patterns, ambient declarations, and const enum handling; reference [dts-bundle-generator/src/generate-output.ts](dts-bundle-generator/src/generate-output.ts) for output formatting.

## Execution Decisions

### 1. Test execution strategy

Implement in order of complexity (simplest first), running tests after each category to ensure correctness. Use vitest's `it.skip` to enable tests one by one, confirming functionality before proceeding. After each successful implementation, unskip the corresponding test in [test/dts-bundler.test.js](test/dts-bundler.test.js). Some tests might start to work after implementing related features, so only make changes for those that fail.

### 2. Code reuse from original

Use the [dts-bundle-generator/src](dts-bundle-generator/src) TypeScript files as reference when implementing features, if there is a better way of solving the same problem with more clear and simple code, then rewrite logic in simpler TypeScript while using original as specification reference?

### 3. API breaking changes

The `bundleDts` function may need additional options parameters for new configurations (sortNodes, umdModuleName, etc.) - extend the existing options object rather than creating a new API. Ensure backward compatibility by defaulting new options to false or undefined.

## Implementation Priority

### Phase 1: Foundation (Steps 1-2)

- Refactor to TypeScript modules
- Validate test fixtures
- **Goal:** Solid foundation with all current tests passing

### Phase 2: Quick Wins (Configuration & File Resolution)

- Implement banner, sort-nodes, umd-module-name
- Add .mts/.cts extension support
- **Goal:** 5-7 additional tests passing, validate architecture

### Phase 3: Core Features (Export & Import Patterns)

- Implement export patterns (Category A)
- Implement import patterns (Category B)
- **Goal:** 17 additional tests passing, major functionality complete

### Phase 4: Advanced Features (Re-exports, Declarations, TypeScript)

- Implement re-exports, module formats, declarations (Category C+D+E)
- Implement remaining TypeScript features (Category G)
- **Goal:** All 30 tests passing, feature complete

### Continuous Integration

- Run `pnpm test` after each feature implementation
- Never proceed if previously passing tests break
- Update snapshots only when intentional changes are made

## Test Categories Overview

### Category A: Export Handling (10 tests)

- export-eq-from-entry
- export-default-from-entry
- export-default-exist-class
- export-namespaces
- export-via-global-declaration
- export-object-with-destructuring
- export-variables-list
- default-export-of-default-export
- export-wrapped-with-namespace-chain
- export-default-no-export-referenced-types

### Category B: Import Handling (7 tests)

- import-type-from-deps
- import-from-types-cause-reference-types
- import-eq
- import-star-from-local-module
- import-default-from-node-modules
- mixed-imports
- inline-from-deps-transitive

### Category C: Re-export Patterns (2 tests)

- re-export-star
- re-export-as-namespace

### Category D: Module Format Support (2 tests)

- mts-extension
- cts-extension

### Category E: Declaration Patterns (2 tests)

- declare-module-and-imports
- dont-inline-declare-global

### Category F: Configuration Options (3 tests)

- banner
- umd-module-name
- sort-nodes

### Category G: TypeScript Features (4 tests)

- recursive-types
- binding-patterns-without-initializer
- ambient-redeclare-types
- respect-preserve-const-enum

## Key Implementation Gaps

1. **Export Statement Support**: No handling of `export =`, `export default`, `export *`, `export * as`, variable exports, or destructuring in exports

2. **Import Statement Support**: No `import = require()` syntax, limited default import handling, no @types detection for triple-slash references, missing transitive dependency resolution

3. **Declaration Support**: No `declare module`, `declare global`, namespace/module declarations, or variable declarations

4. **Configuration Options**: Missing `sortNodes`, `umdModuleName`, `noBanner`, `inlineDeclareGlobals`, `respectPreserveConstEnum`, `exportReferencedTypes` options

5. **Module Resolution**: No support for .mts/.mjs or .cts/.cjs extensions

6. **Type System**: Only handles interfaces, type aliases, classes, enums; missing variable statements, function declarations, const enum handling

## Source File References

Key files from dts-bundle-generator to reference:

- **bundle-generator.ts** (1406 lines): Export handling, re-export logic, module augmentation, namespace wrapping
- **generate-output.ts** (364 lines): Banner, UMD module name, sort nodes, import/export statement generation
- **types-usage-evaluator.ts** (307 lines): Dependency graph, tree-shaking decisions
- **module-info.ts** (154 lines): Module type determination, @types detection, library name extraction
- **collisions-resolver.ts**: Name collision resolution, unique name generation
- **helpers/typescript.ts**: TypeScript AST utilities, export/import symbol resolution

## Code Quality

Write code in TypeScript with clear types and interfaces.
Use `prettier` with `@qlik/prettier-config` for formatting, `eslint` with `@qlik/eslint-config` for linting, and write tests with vitest. Ensure modular code structure in `src/` for maintainability.

**Type Safety:**

- Define clear interfaces for all options and configurations
- Use TypeScript's type system to catch errors at compile time
- Avoid `any` types; use `unknown` with type guards when needed

**Testing Strategy:**

- Run full test suite after each module implementation
- Create integration tests for new API options
- Verify backward compatibility by ensuring 12 original tests always pass

## Building the code

Use `tsdown` to compile the typescript code in `src/` to javascript in a `dist/` folder. package.json `main` and `exports` field should point to the compiled code in `dist/`.
