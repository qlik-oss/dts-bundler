import type { Config } from "another-package";
import type { Config as Config_1 } from "external-package";
import { OtherLib } from "other-lib";
import type { Config as Config_2 } from "third-package";

type AnotherLocalHelper = {
  assist(): void;
  config: Config;
};
type AdditionalLocalHelper = {
  configure(): void;
  settings: Config_1;
};
/**
 * A Local helper type for internal use.
 */
type YetAnotherLocalHelper = {
  setup(): void;
  configuration: Config_2;
};
export interface Combined {
  local: AnotherLocalHelper;
  otherLocal: AdditionalLocalHelper;
  yetAnotherLocal: YetAnotherLocalHelper;
  lib: LibType;
  other: OtherLib;
}
