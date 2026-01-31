declare function justFunction(input: boolean): void;
interface SomeInterface {
  field2: typeof justFunction;
}
declare function justFunction2(): void;
interface SomeInterface {
  field3: typeof justFunction2;
}

export { SomeInterface as default };
