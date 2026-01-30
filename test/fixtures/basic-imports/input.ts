import type { Helper } from "../../internal/helper";

export interface User {
  id: number;
  name: string;
  helper: Helper;
}
