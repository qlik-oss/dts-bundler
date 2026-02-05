// Entry file - imports value only used in typeof expression
// Bug: Should use `import type` but generates value import
import { someFunction } from "external-pkg";

export type FunctionType = typeof someFunction;
export type ReturnType = ReturnType<typeof someFunction>;
