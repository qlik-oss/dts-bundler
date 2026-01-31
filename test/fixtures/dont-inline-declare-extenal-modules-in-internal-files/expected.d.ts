interface Interface {
  field: Interface;
}
declare var ModuleName: { prototype: Interface };
export interface InterfaceInternal extends Interface {}
export declare module ModuleName {
  interface Interface extends InterfaceInternal {}
}
