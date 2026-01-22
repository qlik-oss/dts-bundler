# Plan for porting the dts-bundler-generator project

The code for `dts-bundler-generator` has been added to this project under the `./dts-bundler-generator` folder in this repo which has been cloned from the <https://github.com/timocov/dts-bundle-generator> repository.

The `dts-bundler-generator` project is old and over engineered and has some flaws as it doesn't cover all the use cases. I want to port it to a project that uses modern javascript/typescript features with a good, solid and maintainable structure.

The project follows some standard:

- prettier using the config from `@qlik/prettier-config`
- eslint using the config from `@qlik/eslint-config`
- use vitest as testing framework
- modern es module syntax.

## The Objective

Currently I have a start that covers the most basic use cases. I have used the test cases in the `./dts-bundler-generator/tests/e2e/test-cases` as reference for my own test suite, but it has been simplified into `fixtures` and `__snaphshots__` and vitest is used for executing the tests.

Currently there are 30 skipped tests that has been moved from the `dts-bundle-generator` project. I need help implementing support for those 30 tests in my tool.

I want to:

1. Analyze the skipped test, do they look correct? Does the output make sense when looking at the input? `dts-bundler-generator` has an api where you can specify options of out the bundler should act in different situations. Look at the source test case in the `dts-bundler-generator` project to verify that skipped test cases actually does what it should do and that they make sense.
2. Change the test cases when needed so that the test suite makes sense.
3. After having a clear set of tests that highlights the current gap of the implementation then enable the tests one by one and add the features necessary in the source code. During implementation it is not allowed to alter the output of the tests, unless there's a really good reason for it.

I want to use the code in `dts-bundle-generator` as a reference to solve the different use cases highlighted in the tests. If the implementation in there is good, then use that code.

Currently the implementation is in one file `index.js`. For future maintainability it probably makes sense to split things up into more modules. Those should then be put in a `src` folder.

## Implementation plan

I want help with putting together an implementation plan for the remaining part of this project. I want to write a plan that an co-pilot agent can pick and execute with a good result.
