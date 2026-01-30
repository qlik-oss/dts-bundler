import type { OtherLib } from "other-lib";

/**
 * A Local helper type for internal use.
 */
type LocalHelper = {
  help(): void;
};
/**
 * A Local helper type for internal use.
 */
type OtherLocalHelper = {
  helpMe(): void;
};
export interface Combined {
  local: LocalHelper;
  otherLocal: OtherLocalHelper;
  lib: LibType;
  other: OtherLib;
}
