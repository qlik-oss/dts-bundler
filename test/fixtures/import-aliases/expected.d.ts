type MyStatus = {
  code: number;
  message: string;
};
type MyResult<T> = {
  data: T;
  status: MyStatus;
};
type Status = "running" | "stopped" | "paused";
type Result<T> = {
  score: T;
  status: Status;
};
export type UserStatus = MyStatus;
export type ApiResponse<T> = MyResult<T>;
export type RunnerStatus = Status;
export type RunnerResponse<T> = Result<T>;
export interface Config {
  status: MyStatus;
}

export {};
