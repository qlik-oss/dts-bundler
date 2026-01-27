import { InternalNs } from "./export-eq";
import { ExportEqNs } from "./ns";

export type ExportedNsType = InternalNs.NewType;

export {
  anotherFunc as af1,
  // rename these to include them into import
  AnotherInterface as AI1,
  func as f1,
  Interface as I1,
  MergedSymbol as MS1,
  NamespaceName as NS1,
  TypeName as T1,
  default as TEMPLATE1,
  Variable as V1,
} from "./file1";

export {
  anotherFunc,
  // yes, keep these without renaming so we can check that these aren't exported with wrong names
  AnotherInterface,
  func as f2,
  Interface as I2,
  MergedSymbol as MS2,
  NamespaceName as NS2,
  TypeName as T2,
  default as TEMPLATE2,
  Variable as V2,
} from "./file2";

export { Inter } from "./import-star-1";
export { Inter2 } from "./import-star-2";
export { MyType } from "./type";

export { ExportEqNs };
