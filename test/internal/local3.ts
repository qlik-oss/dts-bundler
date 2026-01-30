// @ts-expect-error - test case for external lib types
import type { Config } from "third-package";

/**
 * A Local helper type for internal use.
 */
export type YetAnotherLocalHelper = {
  setup(): void;
  configuration: Config;
};
