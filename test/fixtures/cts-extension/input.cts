import { Decl } from "./decl.cjs";
import { Interface } from "./file.cjs";

export interface ExportedInterface extends Interface {
  foo: Decl;
}
