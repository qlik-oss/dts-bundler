// Entry file - uses inlined library types in declare global
// Bug: Types from inlined library get exported when they should be internal
import type { InlinedType } from "fake-inlined-lib";

declare global {
  interface MyGlobal {
    data: InlinedType;
  }
}

export {};
