export type Status = "staring" | "ongoing" | "ended";

export type Result<T> = { failure: true; data: T } | { failure: false; error: string };
