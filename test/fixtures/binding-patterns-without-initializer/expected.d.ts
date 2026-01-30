declare const [ARR_FOO = "321", ARR_BAR = 1337];
declare const { OBJ_FOO = 123, OBJ_BAR = 42 };
export type BarType = typeof ARR_BAR | typeof OBJ_BAR;
export type FooType = typeof ARR_FOO | typeof OBJ_FOO;
