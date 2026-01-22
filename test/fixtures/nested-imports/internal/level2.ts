import type { Level3Type } from "./level3";

// Level2Type is an interface that includes a nested Level3Type
export interface Level2Type {
  nested: Level3Type;
}
