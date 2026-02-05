# dts-bundler Compatibility Task List

This document tracks issues identified when comparing `dts-bundler` output to `dts-bundle-generator` output, using the `hub-parcels` project as a test case.

## Test Command

```bash
cd /Users/ann/Coding/qlik/hub-parcels && pnpm bundle-types
```

Configuration: `inlinedLibraries: "@qlik-trial/hub-common"`

## Output Comparison

| Metric         | dts-bundler (new) | dts-bundle-generator (old) |
|----------------|-------------------|----------------------------|
| Output file    | `hub-parcels.ts`  | `hub-parcels-generator.ts` |
| Total lines    | 4819              | 1005                       |
| Exported types | 67                | 3                          |

---

## Issues Identified

### 1. Excessive Exports (CRITICAL)

**Problem:** The new bundler exports 67 types/interfaces/enums/consts, while the old bundler only exports 3.

**Examples of incorrectly exported items:**

- `ResourceTypes`, `SpaceTypes`, `ItemMenuOptionActions`, `NotificationResourceTypes`
- These should be `type X = ...` not `export type X = ...`

**Expected behavior:** Only export types that are:

- Directly exported from the entry file
- Used in the `declare global` block interface definitions

**Root Cause:** Export marking logic is too aggressive.

**Files to investigate:**

- `src/export-resolver.ts`
- `src/output-generator.ts`

---

### 2. Duplicate Type Definitions

**Problem:** Multiple definitions with `$1`, `$2` suffixes appear in the output.

**Examples:**

| Original                    | Duplicate                     |
|-----------------------------|-------------------------------|
| `CustomDashboardSource`     | `CustomDashboardSource$1`     |
| `ResourceReloadStatus`      | `ResourceReloadStatus$2`      |
| `DatasetSubType`            | `DatasetSubType$1`            |
| `NotificationResourceTypes` | `NotificationResourceTypes$1` |
| `ReloadStatusProps`         | `ReloadStatusProps$1`         |
| `WrappedFile`               | `WrappedFile$2`               |

**Expected behavior:** Types that resolve to the same source definition should be deduplicated.

**Root Cause:** Multiple import paths for the same type are not being resolved to a single definition.

**Files to investigate:**

- `src/declaration-collector.ts`
- `src/registry.ts`

---

### 3. Missing Tree-Shaking of Internal Declarations

**Problem:** The bundler includes many declarations that the old bundler tree-shakes away.

**Incorrectly included:**

- Component declarations: `AddItemToCollectionModal`, `AddWidgetsModal`, `CreateAndEditDashboardModal`, `Home`
- Hook declarations: `useAccessControl`, `useCollections`, `useCollection`, `useReloadTask`, `useTask`
- Internal types only used by implementation

**Expected behavior:** Only types referenced by directly exported types should be included. Component/function declarations should be excluded unless directly exported.

**Root Cause:** Tree-shaking not respecting entry-exports-only semantics.

**Files to investigate:**

- `src/tree-shaker.ts`

---

### 4. Inline Return Type Expansion (MAJOR)

**Problem:** Complex return types (especially from React Query hooks) are expanded inline instead of preserving type references.

**Example:** `useAccessControl` generates ~200+ lines of inline union type with repeated properties.

**Affected hooks:**

- `useAccessControl`
- `useCollections`
- `useCollection`
- `useReloadTask`
- `useTask`
- `useItems`
- `useSpaceResourceAccessControls`

**Expected behavior:** These hooks shouldn't be in the output at all (see issue #3). But if they were, they should preserve type references rather than expanding.

**Root Cause:** Type printer expands inferred types fully.

**Files to investigate:**

- `src/ast-printer.ts`
- `src/output-generator.ts`

---

### 5. Extraneous Value Exports from External Libraries

**Problem:** The bundler imports values (functions) from external packages instead of using type-only imports.

**Examples of incorrectly imported values:**

```typescript
import {
  listCollections,  // ❌ value import
  dashboardDelete,  // ❌ value import
  listItems,        // ❌ value import
} from ...
```

**Expected behavior:** All imports from external packages should use `import type { ... }`.

**Root Cause:** Import classification not distinguishing type-only usage.

**Files to investigate:**

- `src/import-parser.ts`
- `src/output-generator.ts`

---

### 6. Duplicate `declare global` Block

**Problem:** The `declare global { interface QlikEmbedUIs { ... } }` block appears twice in the output.

**Locations in output:**

- Lines 855-1013
- Lines 4464-4672

**Expected behavior:** Ambient module declarations should be merged/deduplicated.

**Root Cause:** Global declarations from multiple files not being merged.

**Files to investigate:**

- `src/declaration-collector.ts`
- `src/output-generator.ts`

---

### 7. Incorrect Enum Export Modifier

**Problem:** Enums are exported when they should be internal declarations.

**Example:**

```typescript
// Old bundler (correct)
declare enum NotificationResourceTypes { ... }

// New bundler (incorrect) 
export declare enum NotificationResourceTypes { ... }
```

**Expected behavior:** Match the source file's export status for enums.

**Root Cause:** Same as issue #1 - export marking too aggressive.

---

### 8. Component Declarations Leak

**Problem:** Function/component declarations are included that should be excluded.

**Examples of leaked declarations:**

- `declare const AddItemToCollectionModal`
- `declare const AddWidgetsModal`
- `declare function ItemActionMenuSprout`
- `declare const ItemCard`
- `declare const ItemCardSprout`
- `declare const Home`
- Many more...

**Expected behavior:** Only types needed for the `QlikEmbedUIs` interface and directly exported types should be included.

**Root Cause:** Related to issue #3 - tree-shaking not aggressive enough.

---

## Test Coverage

The following test fixtures have been added to `test/fixtures/` to expose these issues:

| Test Fixture | Issues Covered | Status |
|--------------|----------------|--------|
| `inline-excessive-exports` | #1, #7 | ✅ Passes (simple case works) |
| `tree-shaking` | #3, #8 | ✅ Passes (simple case works) |
| `duplicate-types` | #2 | ✅ Passes (same source deduped) |
| `duplicate-rename` | #2 | ✅ Passes ($N suffix works) |
| `inline-return-type` | #4 | ✅ Passes (type refs preserved) |
| `enum-export-modifier` | #7 | ✅ Passes (enum not exported) |
| `declare-global-merge` | #6 | ✅ Passes (not merged, but valid) |
| `type-only-imports` | #5 | ❌ **Fails** (uses value import) |
| `hub-parcels-real-pattern` | #1 | ❌ **Fails** (inlined types exported) |

### Key Findings

1. **Simple cases work correctly** - The bundler handles basic scenarios properly
2. **Inlined library + declare global = bug** - When types from `inlinedLibraries` are used in `declare global`, they get incorrectly marked as exports
3. **Type-only imports not detected** - Values used only in `typeof` still generate value imports

---

## Priority Classification

### Priority 1: Critical (Output Correctness)

| ID | Issue                              | Status | Test |
|----|------------------------------------|--------|------|
| 1  | Fix Export Marking Logic           | ⬜ TODO | `hub-parcels-real-pattern` ❌ |
| 2  | Fix Duplicate Declaration Handling | ✅ Works | `duplicate-*` ✅ |
| 3  | Improve Tree-Shaking               | ✅ Works | `tree-shaking` ✅ |
| 6  | Fix `declare global` Merging       | ⚠️ Acceptable | Not merged but valid TS |

### Priority 2: Important (Type Quality)

| ID | Issue                                   | Status | Test |
|----|-----------------------------------------|--------|------|
| 4  | Avoid Inline Return Type Expansion      | ✅ Works | `inline-return-type` ✅ |
| 5  | Use `import type` for Type-Only Imports | ⬜ TODO | `type-only-imports` ❌ |
| 7  | Fix Enum Export Modifier                | ✅ Works | `enum-export-modifier` ✅ |

### Priority 3: Nice-to-Have (Polish)

| ID | Issue                             | Status  |
|----|-----------------------------------|---------|
| 8  | Support `entryExportsOnly` Option | ✅ Works |
| -  | Consolidate Import Statements     | ⬜ TODO |
| -  | Better const Variable Handling    | ⬜ TODO |

---

## Remaining Work

Only 2 issues require fixes:

1. **Issue #1** - Inlined library types getting `export` when used with `declare global`
2. **Issue #5** - Value imports not converted to `import type` for type-only usage

---

## Reference Files

### dts-bundler source files to investigate

- `src/export-resolver.ts` - How exports are marked
- `src/tree-shaker.ts` - What gets included/excluded
- `src/output-generator.ts` - How export keywords are emitted
- `src/declaration-collector.ts` - How declarations are deduplicated
- `src/ast-printer.ts` - How types are printed
- `src/import-parser.ts` - How imports are classified
- `src/registry.ts` - How declarations are stored and looked up

### Test files

- `/Users/ann/Coding/qlik/hub-parcels/hub-parcels.ts` - New bundler output
- `/Users/ann/Coding/qlik/hub-parcels/hub-parcels-generator.ts` - Old bundler output (reference)
- `/Users/ann/Coding/qlik/hub-parcels/src/types/qmfe-hub-parcels.public.ts` - Entry point

### Old bundler reference

- `/Users/ann/Coding/javascript/dts-bundle-generator/src/bundle-generator.ts`
