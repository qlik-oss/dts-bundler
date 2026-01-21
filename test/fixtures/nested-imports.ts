import type { Level2Type } from "./internal/level2";
import type { LocalHelper } from "./internal/local";

export interface Level1 {
  data: Level2Type;
  helper: LocalHelper;
}
