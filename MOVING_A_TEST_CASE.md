# How to move a test-case from dts-bundler-generator to fixtures and dts-bundler.test.ts

A folder in #file:test-cases have. Some files should be copied over to a corresponding folder in #file:fixtures and some should not be copied

- config.ts -> any option stated here should go into the `runTestCase` function as option object. Don't copy the file
- output.d.ts -> this is the expected output, which should be copied and renamed to a expected.d.ts file in the correspoinding folder in #file:fixtures . The `export {}` should be removed (unless the input specifically stated that) and only the exported things stated in the input file should be exported in the output file.
- input.ts -> this is the input file, it should be copied over intact.
- index.spec.js -> don't copy this one.
- tsconfig.json -> copy this one
- any other file should be copied over as is, since they're likeley imported by the input file.

## test cases to move (maybe)

- export-keyof-typeof-var-type - typeof/keyof handling
- import-variables - Variable imports
- non-exported-abstract-class - Abstract class handling
- strip-export-from-non-exported-class - Export keyword stripping
- primitive-generation - Function primitives
- merged-namespaces - Namespace merging (complex)
