import { default as DefaultClass, default as DefaultClassRenamed, default as DefaultClassRenamed2 } from "package-with-default-export";

export interface ExportedInterface {
  field1: typeof DefaultClass;
  field2: typeof DefaultClassRenamed;
  field3: typeof DefaultClassRenamed2;
}
