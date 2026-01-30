/// <reference types="node" />

import type { InterfaceFromTypesPackage } from "fake-types-lib";
import type { Stats } from "fs";

export interface InterfaceName {
  prop: Stats;
  field: InterfaceFromTypesPackage;
}
