import type { ModuleWithoutQuotes } from "fake-package";

interface Interface {
  field: Interface;
}
declare namespace ExportedModule {
  type Foo = string;
}
declare var ModuleName: { prototype: Interface };
declare module "ambient-module" { }
export interface InterfaceInternal extends Interface {}
export declare module ModuleName {
  interface Interface extends InterfaceInternal {}
  type Bar = ExportedModule.Foo;
  type Foo = ModuleWithoutQuotes.A;
}
