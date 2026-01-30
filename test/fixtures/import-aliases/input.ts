import type { Result as MyResult, Status as MyStatus } from "./type-aliases1";
import type { Result, Status } from "./type-aliases2";

export type UserStatus = MyStatus;

export type ApiResponse<T> = MyResult<T>;

export type RunnerStatus = Status;

export type RunnerResponse<T> = Result<T>;

export interface Config {
  status: MyStatus;
}

export {};
