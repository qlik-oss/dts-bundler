import { Barfoo } from "package-with-re-exports";

// should be run with inlineDeclareExternals=true
declare module "fake-package" {
  export type A = Barfoo;
}
