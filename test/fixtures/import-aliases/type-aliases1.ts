export type Status = {
  code: number;
  message: string;
};

export type Result<T> = {
  data: T;
  status: Status;
};
