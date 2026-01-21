import type { LocalHelper } from "./internal/local";
// @ts-expect-error - test case for external lib types
import { LibType } from "@myorg/lib";
// @ts-expect-error - test case for external lib types
import { OtherLib } from "other-lib";

export interface Combined {
  local: LocalHelper;
  lib: LibType;
  other: OtherLib;
}
