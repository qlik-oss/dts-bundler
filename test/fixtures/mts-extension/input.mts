import { Decl } from "./decl.mjs";
import { Interface } from "./file.mjs";

export interface ExportedInterface extends Interface {
  foo: Decl;
}
