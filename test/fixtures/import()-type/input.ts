import { NonDefaultInterface as DFI } from "package-with-default-export";
import { MyType } from "./my-type";

export type MySecondType = MyType | number | DFI;
