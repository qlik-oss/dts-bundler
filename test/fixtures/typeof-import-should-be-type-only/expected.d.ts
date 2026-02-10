import type { someFunction } from "external-pkg";

export type FunctionType = typeof someFunction;
export type ReturnType = ReturnType<typeof someFunction>;
