// @ts-expect-error - test case for external lib types
import type { Config } from "external-package";

/**
 * A Local helper type for internal use.
 */
export type OtherLocalHelper = {
  helpMe(): void;
};

export type AdditionalLocalHelper = {
  configure(): void;
  settings: Config;
};
