import type * as wholePackage from "package-with-default-export";
import type DefaultClass, {
  NonDefaultInterface,
  default as RenamedDefaultClass,
  NonDefaultInterface as RenamedInterface,
} from "package-with-default-export";
import type * as starImportNameModule from "package-with-default-export/namespace";
import type {
  default as defaultImportedNamespace,
  default as defaultImportedNamespace2,
} from "package-with-default-export/namespace";

export interface ExportedInterface {
  field1: typeof DefaultClass;
  field2: NonDefaultInterface;
  field3: typeof RenamedDefaultClass;
  field4: RenamedInterface;
  field5: typeof wholePackage;
  field6: defaultImportedNamespace.Options;
  field7: defaultImportedNamespace2.Options;
  field8: typeof starImportNameModule;
}
