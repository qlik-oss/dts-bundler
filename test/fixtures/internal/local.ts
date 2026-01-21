// @ts-expect-error - test case for external lib types
import type { Config } from "another-package";

/**
 * A Local helper type for internal use.
 */
export type LocalHelper = {
  help(): void;
};

export type AnotherLocalHelper = {
  assist(): void;
  config: Config;
};
