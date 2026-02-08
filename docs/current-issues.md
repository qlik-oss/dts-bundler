# dts-bundler Compatibility Task List

This document tracks issues identified when comparing `dts-bundler` output to `dts-bundle-generator` output, using the `hub-parcels` project as a test case.

## Reference files and folders

- `/Users/ann/Coding/javascript/dts-bundler/reference/hub-parcels` - folder for the hub-parcels project
- `/Users/ann/Coding/javascript/dts-bundler/reference/hub-parcels/package.json` - the bundle command `pnpm bundle-types`
- `/Users/ann/Coding/javascript/dts-bundler/reference/hub-parcels/src/types/qmfe-hub-parcels.public.ts` - the input file for the type bundling
- `/Users/ann/Coding/javascript/dts-bundler/reference/hub-parcels/hub-parcels.ts` - output file by `dts-bundler`
- `/Users/ann/Coding/javascript/dts-bundler/reference/hub-parcels/hub-parcels-generator.ts` - output file by `dts-bundle-generator`
- `/Users/ann/Coding/javascript/dts-bundler/reference/dts-bundle-generator` - The reference project

_NOTE_ Configuration when bundling hub-parcels is using `inlinedLibraries: "@qlik-trial/hub-common"`

---

## Issues Identified

### 1. Excessive Exports (CRITICAL)

**Problem:** The new bundler exports 67 types/interfaces/enums/consts, while the old bundler only exports 3. It is correct to only
export 3, since that is what the input file does. The bundler should only export what is specifically stated in the import.

**Examples of incorrectly imported items:**

- `TypographyProps`, `PopoverOrigin`, `ItemMenuOptionActions`, `NotificationResourceTypes`
- These are used by types that are either not directly exported or exported through the global scope in a `declare global` construct.

**Expected behavior:** Only export types that are:

- Directly exported from the entry file
- Used in the `declare global` block interface definitions

---

### 2. Duplicate Type Definitions

**Problem:** Multiple definitions with `$1`, `$2` suffixes appear in the output.

**Examples:**

| Original                    | Duplicate                     |
| --------------------------- | ----------------------------- |
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

**Expected behavior:** These hooks shouldn't be in the output at all

**Root Cause:** Type printer expands inferred types fully.

---

### 5. Duplicate `declare global` Block

**Problem:** The `declare global { interface QlikEmbedUIs { ... } }` block appears twice in the output.

**Expected behavior:** Ambient module declarations should be merged/deduplicated.

**Root Cause:** Global declarations from multiple files not being merged.

**Files to investigate:**

- `src/declaration-collector.ts`
- `src/output-generator.ts`

---

### 6. Incorrect Enum Export Modifier

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

### 7. Component Declarations Leak

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

### Key Findings

1. **Simple cases work correctly** - The bundler handles basic scenarios properly
2. **Inlined library + declare global = bug** - When types from `inlinedLibraries` are used in `declare global`, they get incorrectly marked as exports
3. **Type-only imports not detected** - Values used only in `typeof` still generate value imports

---
