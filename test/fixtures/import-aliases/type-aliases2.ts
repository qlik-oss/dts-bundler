export type Status = "running" | "stopped" | "paused";

export type Result<T> = {
  score: T;
  status: Status;
};
