export * as MyNamespace1 from "./another-exports";
export * as MyNamespace from "./exports";

import { MyInt } from "./exports";
import * as MyNamespace4 from "./one-more-exports";
import * as SomeLocalNsName from "./one-more-exports";

export interface MyNamespace2 {
  field: MyInt;
}

export type Type = MyInt;

export { SomeLocalNsName as MyNamespace3, MyNamespace4 };
