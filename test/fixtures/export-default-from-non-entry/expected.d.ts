declare class MyAnotherClass {}
declare class MyClass {}
export interface MyInterface {}
declare class MyNewClass extends MyClass implements MyInterface {}
export declare class MyNewClass2 extends MyAnotherClass {}

export { MyNewClass as default };
