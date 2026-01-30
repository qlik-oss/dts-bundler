// @ts-expect-error - test case for external lib types
import type { SomeType } from "external-package";
// @ts-expect-error - test case for external lib types
import type { TypeOnly } from "another-package";

export interface MyType {
  data: SomeType;
  other: TypeOnly;
}
