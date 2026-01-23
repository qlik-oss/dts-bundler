# Development Instructions for AI Assistants

## Test Implementation Rules

When implementing test cases in this repository, follow these strict rules:

### Process

1. **Analyze First**: Read and understand both `test/fixtures/[test-name]/input.ts` and `test/fixtures/[test-name]/expected.d.ts` before writing any code
2. **Expected Output is Sacred**: You are FORBIDDEN from modifying `expected.d.ts` files to make tests pass
3. **Implementation Must Match Spec**: If tests fail, fix the implementation code in `src/`, never the test expectations
4. **Validation Required**: After implementation, always run:
   - `pnpm test` - ensure no regressions
   - `pnpm lint` - code style compliance
   - `pnpm check-types` - TypeScript type safety

### Red Flags

❌ NEVER modify files in `test/fixtures/*/expected.d.ts`
❌ NEVER say "let me update the expected output to match"
❌ NEVER change test expectations without explicit discussion

### Exception Handling

If you genuinely believe an expected output is incorrect (violates TypeScript rules, has syntax errors, etc.):

1. STOP implementation
2. Explain the issue with evidence (TypeScript documentation, compiler behavior, etc.)
3. Wait for human confirmation before proceeding

### The Golden Rule

**The expected output files are the specification. Your job is to make the implementation match the spec, not the other way around.**

## Reference Code - Do Not Modify

The `dts-bundle-generator/` folder contains the original dts-bundle-generator project for reference purposes only.

**NEVER modify any files in `dts-bundle-generator/`**

- This code is for reference and comparison
- Our implementation in `src/` is a clean rewrite
- Use it to understand patterns but don't copy-paste
- Don't update or "fix" anything in this folder

## Code Quality Standards

- All code must pass TypeScript strict mode checks
- Follow the existing code style (enforced by ESLint)
- Use proper null checks - avoid unnecessary conditionals but handle edge cases
- Add comments for complex logic, especially AST traversal code
