declare class Bar {}
declare const x = 1;

declare namespace Foo {
  export { Bar, x };
}

export type { Foo };
