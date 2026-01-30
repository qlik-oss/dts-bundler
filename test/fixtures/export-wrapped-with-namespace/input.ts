export * as MyNamespace from "./exports";
export * as MyNamespace1 from "./another-exports";
export * as MyNamespace2 from "./another-exports";

import { MyInt } from "./exports";
import * as MyNamespace4 from "./one-more-exports";
import * as SomeLocalNsName from "./one-more-exports";

export interface MyNamespace2 {
  field: MyInt;
}

export type Type = MyInt;

export { SomeLocalNsName as MyNamespace3, MyNamespace4 };
