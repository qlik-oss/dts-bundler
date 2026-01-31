export * from "fs";
export { Server } from "http";
export { default } from "package-with-default-export";
export { default as MyClass } from "./class";
export { default as DefInterface, SomeInterface as Int1, AnotherInterface as Int2, SomeInterface } from "./interface";
export { constName as cName, default as defFunction, funcName as fName, letName as lName } from "./variables";
export { NonDefaultInterface };

import { NonDefaultInterface } from "package-with-default-export";
