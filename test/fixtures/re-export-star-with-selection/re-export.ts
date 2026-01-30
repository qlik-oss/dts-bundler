export * from "fake-package";
export * from "package-with-cyclic-re-export-1";
export { NonDefaultInterface, NonDefaultInterface as Type } from "package-with-default-export";
export * from "package-with-re-exports";

export * from "./re-export2";

export type Foo = string;
export type Bar = Foo;
