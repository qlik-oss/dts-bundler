import type { Path } from "fake-path";
import type { InterfaceFromTypesPackage } from "fake-types-lib";

export interface File {
  path: Path;
}
interface Interface {}
export interface InterfaceWithFields {
  field: Type;
  field2: Interface;
  field3: InterfaceFromTypesPackage;
}
type Type = number | string;
