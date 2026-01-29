import type { Helper } from "../../internal/helper";

// @ts-expect-error - this is supposed to be an unknown type
type IKnowWhatImDoing = any;

// @ts-ignore - remove me
type OkiDoki = IKnowWhatImDoing;

export interface User {
  id: IKnowWhatImDoing;
  name: OkiDoki;
  helper: Helper;
}
