import type { Result, Status } from "./internal/typeAliases";

export type UserStatus = Status;

export type ApiResponse<T> = Result<T>;

export interface Config {
  status: Status;
}

export {};
