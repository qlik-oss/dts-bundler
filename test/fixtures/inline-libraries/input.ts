import type { LocalHelper } from "../../internal/local";
import type { OtherLocalHelper } from "../../internal/local2";

import type { LibType } from "@myorg/lib";
// @ts-expect-error - test case for external lib types
import type { OtherLib } from "other-lib";

export interface Combined {
  local: LocalHelper;
  otherLocal: OtherLocalHelper;
  lib: LibType;
  other: OtherLib;
}
