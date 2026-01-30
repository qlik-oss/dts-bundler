type Decl = string;
interface Interface {}
export interface ExportedInterface extends Interface {
  foo: Decl;
}
