import * as firstImportInModule from "package-with-default-export";

type ExportedType = string | number;
export interface ExportedInterface {
  field1: typeof firstImportInModule.default;
  field2: typeof firstImportInModule.default;
  field3: typeof firstImportInModule;
  field4: ExportedType;
}
