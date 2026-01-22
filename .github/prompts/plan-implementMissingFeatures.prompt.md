# Implementation Plan: Missing Features for dts-bundler

## Overview

This plan addresses 31 failing test cases that reveal missing features in the dts-bundler implementation. The features are organized into 4 phases based on dependencies and complexity.

**Total Estimated Effort**: 53-72 hours

---

## Phase 1: Foundation (15-20 hours)

**Goal**: Implement core module system support and essential file handling

### 1.1 Module Format Extensions (3-4h)

**Tests**: `mts-extension`, `cts-extension`

- Support `.mts`/`.cts` input files
- Rewrite imports to `.mjs`/`.cjs` in output
- Handle ESM/CJS module format detection

### 1.2 CommonJS Export Assignment (4-5h)

**Tests**: `export-eq-from-entry`, `export-eq-from-non-entry`

- Parse `export = SomeClass` syntax
- Convert to appropriate declaration format
- Handle class/function/variable/namespace exports
- Differentiate entry vs non-entry export behavior

### 1.3 CommonJS Import Assignment (2-3h)

**Tests**: `import-eq`, `import-eq-with-interop`

- Parse `import Module = require('pkg')` syntax
- Handle namespace imports
- Support `esModuleInterop` flag interactions

### 1.4 Re-export Star (3-4h)

**Tests**: `re-export-star`, `re-export-star-exclude-ambient`

- Implement `export * from 'package'` handling
- Resolve and inline all exported members
- Handle ambient type exclusion
- Manage naming conflicts

### 1.5 Banner Configuration (2-3h)

**Tests**: `banner`, `no-banner`

- Add `banner` option to API
- Control header comment output
- Default behavior vs explicit configuration

### 1.6 Library Reference Comments (1-2h)

**Tests**: `no-library-reference`

- Add option to disable `/// <reference lib="..." />`
- Control triple-slash directive output

**Phase 1 Completion**: 6 tests passing → 17/42 total

---

## Phase 2: Export Patterns (18-24 hours)

**Goal**: Handle complex export patterns, namespaces, and declaration merging

### 2.1 Default Export Handling (5-7h)

**Tests**: `export-default-exist-class`, `export-default-no-export-referenced-types`, `export-default-unnamed-statement`

- Preserve default export identity
- Handle unnamed class/function defaults
- Control referenced type inlining with `exportReferencedTypes` option
- Maintain proper declaration merging

### 2.2 Namespace Declarations (6-8h)

**Tests**: `export-namespaces`, `export-wrapped-with-namespace-export-eq-export`, `export-wrapped-with-namespace-export-eq-inline`

- Parse `declare namespace` and `export namespace`
- Handle nested namespace structures
- Manage namespace + `export =` combinations
- Control inlining behavior

### 2.3 Variable Export Lists (2-3h)

**Tests**: `export-variables-list`

- Handle `export { a, b, c }` multi-variable syntax
- Preserve variable declarations and initializers
- Track dependencies correctly

### 2.4 Object Destructuring Exports (2-3h)

**Tests**: `export-object-with-destructuring`

- Parse destructured object exports
- Maintain type information through destructuring
- Handle nested destructuring patterns

### 2.5 Type-Only Imports (1-2h)

**Tests**: `import-type-from`

- Distinguish `import type` from regular imports
- Handle type-only import elimination
- Preserve when necessary for type references

### 2.6 Export Type-Only (1-2h)

**Tests**: `export-type-from`

- Handle `export type { X } from 'module'`
- Type-only re-export syntax
- Proper filtering in output

**Phase 2 Completion**: 14 tests passing → 31/42 total

---

## Phase 3: Declarations & Configuration (12-16 hours)

**Goal**: Support global/module declarations and advanced configuration options

### 3.1 Declare Global Blocks (3-4h)

**Tests**: `export-via-global-declaration`, `dont-inline-declare-global`

- Parse `declare global` blocks
- Control inlining behavior
- Preserve global augmentations
- Handle `inlineDeclareGlobals` option

### 3.2 Declare Module Blocks (3-4h)

**Tests**: `declare-module-in-internal-files`, `dont-inline-declare-extenal-modules-in-internal-files`

- Parse `declare module 'name'` blocks
- Control inlining for internal vs external modules
- Handle `inlineDeclareExternals` option

### 3.3 Export Referenced Types Option (2-3h)

**Tests**: Multiple (already covered in 2.1)

- Implement `exportReferencedTypes` configuration
- Control whether internal types are exported
- Handle transitive type dependencies

### 3.4 UMD Module Name (2-3h)

**Tests**: `umd-module-name`

- Parse `export as namespace MyLibrary` syntax
- Include UMD namespace declaration in output
- Handle global namespace exports

### 3.5 Sort Options (2-3h)

**Tests**: `sort-exports`, `sort-imports`

- Add `sortExports` and `sortImports` options
- Implement alphabetical sorting
- Maintain dependency order constraints

**Phase 3 Completion**: 6 tests passing → 37/42 total

---

## Phase 4: Advanced Features (8-12 hours)

**Goal**: Handle edge cases and advanced TypeScript features

### 4.1 Const Enum Support (2-3h)

**Tests**: `const-enum`

- Preserve const enum declarations
- Handle const enum member references
- Inline vs preserve options

### 4.2 Transitive Dependencies (2-3h)

**Tests**: `transitive-deps`

- Trace dependencies through multiple levels
- Include transitively referenced types
- Avoid duplication

### 4.3 Recursive Type Handling (2-3h)

**Tests**: `recursive-type-references`

- Detect recursive type definitions
- Break circular dependencies
- Preserve type semantics

### 4.4 JavaScript File Support (1-2h)

**Tests**: `allow-js`

- Handle `.js` input files with `allowJs`
- Parse JSDoc type annotations
- Generate `.d.ts` from JS sources

### 4.5 Type-Checking Options (1-2h)

**Tests**: Various edge cases

- Respect `skipLibCheck`
- Handle `strict` mode variations
- Support project reference configurations

**Phase 4 Completion**: 5 tests passing → 42/42 total

---

## Implementation Strategy

### Development Workflow

1. **For each feature**:
   - Read failing test fixture (input + expected output)
   - Trace through bundler phases to locate insertion point
   - Implement handling in appropriate phase class
   - Run test with `npm test -- -t "test-name"`
   - Debug and iterate

2. **Integration points**:
   - **TypeRegistry**: Type resolution and tracking
   - **FileCollector**: Module discovery and loading
   - **DeclarationParser**: AST parsing and transformation
   - **TreeShaker**: Dependency analysis
   - **OutputGenerator**: Final code generation

3. **Testing approach**:
   - Fix tests incrementally
   - Run full suite after each phase
   - Use `UPDATE_EXPECTED=1` only when confident
   - Verify no regressions in passing tests

### Risk Mitigation

- **Namespace complexity**: Most complex feature, allocate extra time
- **AST manipulation**: TypeScript compiler API has edge cases, expect debugging
- **Dependency tracking**: Changes may affect tree-shaking, test thoroughly
- **Module formats**: CJS/ESM interop is subtle, validate multiple scenarios

### Validation Criteria

- All 42 tests passing
- No false positives (manually verify expected outputs are correct)
- Performance acceptable (< 2s for test suite)
- Code coverage maintained or improved

---

## Priority Adjustments

**If time-constrained, prioritize**:

1. **Phase 1** (all) - Core functionality
2. **Phase 2.1-2.2** - Default exports + namespaces (most requested)
3. **Phase 3.1** - Declare global (common use case)
4. **Phase 2.3-2.6** - Export patterns
5. **Phase 3.2-3.5** - Declarations + config
6. **Phase 4** - Nice-to-have

**Can defer**:

- Sort options (low impact)
- Const enum (rare)
- JavaScript support (niche)

---

## Next Steps

1. **Review this plan**: Validate priorities and estimates
2. **Set up tracking**: Create issues or checklist for each feature
3. **Begin Phase 1**: Start with `mts-extension` (simplest)
4. **Iterate**: Fix one test at a time, commit incrementally
5. **Refactor**: After Phase 2, consider refactoring if code becomes complex
6. **Document**: Update README with new options and capabilities

**Estimated Timeline**: 2-3 weeks at 4-6 hours/day, or 1 week full-time
