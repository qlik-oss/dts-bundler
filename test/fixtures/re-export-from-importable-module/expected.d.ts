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
declare function funcName(): void;
declare let letName: number;
export declare class MyClass {}
interface SomeInterface {
  field: string;
}
interface DefaultInterface {
  field: boolean;
}
declare function defaultFunction(): void;

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
