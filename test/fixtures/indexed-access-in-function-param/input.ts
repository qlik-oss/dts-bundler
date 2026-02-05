import type { InterfaceWithFields } from "fake-package";

// Arrow function with indexed access type in parameter annotation
export const myHandler = ({ field }: { field: InterfaceWithFields["field"] }): void => {};
