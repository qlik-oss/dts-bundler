interface Interface {
  field: Interface;
}
declare namespace ExportedModule {
  type Foo = string;
}
declare var ModuleName: { prototype: Interface };
export interface InterfaceInternal extends Interface {}
export declare module ModuleName {
  interface Interface extends InterfaceInternal {}
  type Bar = ExportedModule.Foo;
}
