import type { Result as MyResult, Status as MyStatus } from "./internal/typeAliases";

export type UserStatus = MyStatus;

export type ApiResponse<T> = MyResult<T>;

export interface Config {
  status: MyStatus;
}

export {};
