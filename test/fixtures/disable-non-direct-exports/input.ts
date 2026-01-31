import { ConstEnum2, Enum2 } from "./enums";
import { Class, ConstEnum, Enum, func, Interface, Type, variable } from "./module";

export interface ExportedInterface {
  class: Class;
  constEnum: ConstEnum;
  constEnum2: ConstEnum2;
  enum: Enum;
  enum2: Enum2;
  func: typeof func;
  interface: Interface;
  type: Type;
  variable: typeof variable;
}
