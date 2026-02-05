# Implementation Plan: dts-bundler Compatibility

This document outlines a phased approach to fix the issues identified in [todo-list.md](./todo-list.md).

## Approach

Each phase addresses related issues and includes:

1. **Test fixture** - Minimal reproduction that fails with current behavior
2. **Implementation fix** - Targeted changes to source files
3. **Validation** - Run \`pnpm test\` to confirm fix and no regressions

## Phase 1: Export Marking (Issues #1, #7)

**Goal:** Only mark declarations as \`export\` when they are directly exported from the entry file.

### Problem

Currently, the bundler exports 67 types when only 3 should be exported. Internal helper types like \`ResourceTypes\`, \`SpaceTypes\`, enums like \`NotificationResourceTypes\` are incorrectly getting the \`export\` modifier.

### Test Fixture

\`test/fixtures/inline-excessive-exports/\`

This fixture has:

- Entry file that exports a single interface
- The interface references internal types
- Expected output: only the interface has \`export\`, referenced types do not

### Files to Modify

- \`src/export-resolver.ts\` - Tighten logic for what gets marked as exported
- \`src/output-generator.ts\` - Ensure export modifier only applied to entry exports

### Success Criteria

\`\`\`typescript
// Input: export { PublicAPI } from "./api";
// api.ts: export interface PublicAPI { config: InternalConfig }
// types.ts: export interface InternalConfig { debug: boolean }

// Expected output:
export interface PublicAPI {
  config: InternalConfig;
}
interface InternalConfig {
  debug: boolean;
}
// NOT: export interface InternalConfig { ... }
\`\`\`

---

## Phase 2: Tree-Shaking (Issues #3, #8)

**Goal:** Exclude component/function declarations that aren't needed for type exports.

### Problem

The bundler includes declarations like \`AddItemToCollectionModal\`, \`useAccessControl\`, etc. These are implementation details that shouldn't appear in the declaration bundle.

### Test Fixture

\`test/fixtures/tree-shaking/\`

This fixture has:

- Entry file that exports only a type
- Source files with component declarations
- Expected output: only types, no component/function declarations

### Files to Modify

- \`src/tree-shaker.ts\` - Add logic to exclude function/const declarations not in entry exports

### Success Criteria

\`\`\`typescript
// Input has: export type Theme, const ThemeProvider, function useTheme
// Entry only exports Theme

// Expected output:
export type Theme = "light" | "dark";
// NO: declare const ThemeProvider, declare function useTheme
\`\`\`

---

## Phase 3: Deduplication (Issues #2, #6)

**Goal:** Merge identical types and global declarations.

### Problem

Types appear multiple times with \`\$1\`, \`\$2\` suffixes. Global declarations (\`declare global\`) appear twice.

### Test Fixtures

\`test/fixtures/duplicate-types/\` - Same type imported from different paths
\`test/fixtures/declare-global-merge/\` - Multiple declare global blocks

### Files to Modify

- \`src/declaration-collector.ts\` - Track canonical source for types
- \`src/registry.ts\` - Resolve imports to same definition
- \`src/output-generator.ts\` - Merge declare global blocks

### Success Criteria

\`\`\`typescript
// Both moduleA and moduleB re-export same SharedType
// Entry imports from both

// Expected output:
interface SharedType { id: string }
// NOT: interface SharedType { id: string }, interface SharedType\$1 { id: string }
\`\`\`

---

## Phase 4: Import Quality (Issue #5)

**Goal:** Use \`import type\` for type-only imports.

### Problem

The bundler generates value imports for functions/values that are only used as types.

### Test Fixture

\`test/fixtures/type-only-imports/\`

### Files to Modify

- \`src/import-parser.ts\` - Track how imports are used
- \`src/output-generator.ts\` - Generate \`import type\` when appropriate

### Success Criteria

\`\`\`typescript
// When function is only used in typeof:
// type Handler = typeof externalFunction

// Expected import:
import type { externalFunction } from "external-pkg";
// NOT: import { externalFunction } from "external-pkg";
\`\`\`

---

## Execution Order

| Phase | Issues | Priority | Estimated Complexity |
|-------|--------|----------|----------------------|
| 1     | #1, #7 | CRITICAL | Medium               |
| 2     | #3, #8 | HIGH     | Medium               |
| 3     | #2, #6 | HIGH     | High                 |
| 4     | #5     | MEDIUM   | Low                  |

## Validation Checklist

After each phase:

- [ ] \`pnpm test\` passes
- [ ] \`pnpm lint\` passes
- [ ] \`pnpm check-types\` passes
- [ ] \`pnpm build\` passes
- [ ] Manual test: \`cd hub-parcels && pnpm bundle-types\` produces smaller output

## Final Success Metrics

| Metric         | Current | Target   |
|----------------|---------|----------|
| Output lines   | 4819    | ~1000    |
| Exported types | 67      | 3        |
| Duplicate \$N  | Many    | 0        |
| Declare global | 2       | 1        |
