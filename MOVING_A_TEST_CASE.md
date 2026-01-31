# How to move a test-case from dts-bundler-generator to fixtures and dts-bundler.test.ts

A folder in #file:test-cases have. Some files should be copied over to a corresponding folder in #file:fixtures and some should not be copied

- config.ts -> any option stated here should go into the `runTestCase` function as option object. Don't copy the file
- output.d.ts -> this is the expected output, which should be copied and renamed to a expected.d.ts file in the correspoinding folder in #file:fixtures . The `export {}` should be removed (unless the input specifically stated that) and only the exported things stated in the input file should be exported in the output file.
- input.ts -> this is the input file, it should be copied over intact.
- index.spec.js -> don't copy this one.
- tsconfig.json -> copy this one
- any other file should be copied over as is, since they're likeley imported by the input file.

## test cases to move (maybe)

Import Patterns:
9. several-import-star-from-one-package
10. several-import-default-from-one-package
11. import-with-different-names - 3 different import styles from same package

Rename with External (import-aliases only covers local):
12. rename-imports - aliased imports from external packages

Move These Later (Medium Priority)
Tree Shaking/Export Stripping:
13. strip-export-from-non-exported-enum
14. strip-export-from-non-exported-function
15. disable-non-direct-exports

Module Declarations:
16. declare-module-in-internal-files
17. declare-unknown-modules
18. modules-in-internal-files-without-inline-declare-globals
19. dont-inline-declare-extenal-modules-in-internal-files

Complex Patterns:
20. extend-other-module-complex
21. different-default-export-names-in-project
22. import-from-interface-with-export-eq
23. import-from-namespace-in-cjs
24. handle-export-eq-from-npm
25. merged-symbols
26. top-level-declarations
27. rename-local-class
28. inline-package-with-namespaced-import

Namespace Chain Variants:
29. export-wrapped-with-namespace-chain-but-via-imports
30. export-wrapped-with-namespace-chain-inline
31. export-wrapped-with-namespace-export-eq-export
32. export-wrapped-with-namespace-export-eq-inline

Move These Last (Low Priority)
Edge Cases:
33. underscore-in-name
34. import-compound-type-from-npm-cause-unnecessary-import
35. import-from-non-relative-path-inferred-type
36. import-package-with-declaration-merging-with-default-lib

TypeScript Paths:
37. re-export-from-paths-module
38. re-export-with-paths
39. re-export-from-importable-module
40. re-export-in-modules
41. re-export-in-node_modules

Feature-Specific:
42. external-types
43. allow-js
44. custom-types-folder
45. include-exclude-in-tsconfig
46. using-custom-types
