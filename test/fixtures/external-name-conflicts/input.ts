import type { AnotherLocalHelper } from "../../internal/local";
import type { AdditionalLocalHelper } from "../../internal/local2";
import type { YetAnotherLocalHelper } from "../../internal/local3";

// @ts-expect-error - test case for external lib types
import { LibType } from "@myorg/lib";
// @ts-expect-error - test case for external lib types
import { OtherLib } from "other-lib";

export interface Combined {
  local: AnotherLocalHelper;
  otherLocal: AdditionalLocalHelper;
  yetAnotherLocal: YetAnotherLocalHelper;
  lib: LibType;
  other: OtherLib;
}
