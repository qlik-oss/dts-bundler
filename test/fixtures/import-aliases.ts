import type { Result as MyResult, Status as MyStatus } from "./internal/typeAliases";
import type { Result, Status } from "./internal/typeAliases2";

export type UserStatus = MyStatus;

export type ApiResponse<T> = MyResult<T>;

export type RunnerStatus = Status;

export type RunnerResponse<T> = Result<T>;

export interface Config {
  status: MyStatus;
}

export {};
