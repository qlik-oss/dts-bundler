import { Interface } from "fake-package";

interface MyInt {}
type MyString$2 = string;
interface MyInt$2 {}
declare function func$2(): void;
type MyString = string;
declare function func(): void;
type MyType = string;
type MyType2 = string;
type MyString$1 = string;
interface MyInt$1 {}
declare function func$1(): void;
interface MyNamespace2 {
  field: MyInt;
}
export type Type = MyInt;

declare namespace subNs {
  export { MyType2 };
}
declare namespace MyNamespace3 {
  export { Interface, MyInt$2 as MyInt, MyString$2 as MyString, MyType, MyType2, func$2 as func, subNs };
}
declare namespace MyNamespace4 {
  export { Interface, MyInt$2 as MyInt, MyString$2 as MyString, MyType, MyType2, func$2 as func, subNs };
}
declare namespace MyNamespace {
  export { Interface, MyInt, MyString, func };
}
declare namespace MyNamespace1 {
  export { Interface, MyInt$1 as MyInt, MyString$1 as MyString, func$1 as func };
}
declare namespace MyNamespace2 {
  export { Interface, MyInt$1 as MyInt, MyString$1 as MyString, func$1 as func };
}

export { MyNamespace, MyNamespace1, MyNamespace2, MyNamespace3, MyNamespace4 };
