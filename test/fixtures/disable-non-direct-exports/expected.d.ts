declare class Class {}
declare const enum ConstEnum {}
// note it doesn't have `declare` keyword
declare const enum ConstEnum2 {}
declare enum Enum {}
// note it doesn't have `declare` keyword
declare enum Enum2 {}
declare function func(): void;
interface Interface {}
type Type = string;
declare const variable: string;
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
