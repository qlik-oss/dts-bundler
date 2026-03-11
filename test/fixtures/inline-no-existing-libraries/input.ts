// @ts-expect-error - test case for external lib types
import type { LibType } from "@notexisting/library";

export interface Combined {
  lib: LibType;
}
