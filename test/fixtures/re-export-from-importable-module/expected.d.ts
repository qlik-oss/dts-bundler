/// <reference types="node" />

import { Server } from "http";
import {
  default,
  NonDefaultInterface,
} from "package-with-default-export";

interface AnotherInterface {
  field: number;
}
declare const constName = "const";
declare let letName: number;
declare function funcName(): void;
interface SomeInterface {
  field: string;
}
interface DefaultInterface {
  field: boolean;
}
declare function defaultFunction(): void;
export declare class MyClass {}

export * from "fs";

export {
  constName as cName,
  defaultFunction as defFunction,
  DefaultInterface as DefInterface,
  funcName as fName,
  SomeInterface as Int1,
  AnotherInterface as Int2,
  letName as lName,
  NonDefaultInterface,
  Server,
};
