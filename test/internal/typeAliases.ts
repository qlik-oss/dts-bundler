export type Status = "pending" | "active" | "completed";

export type Result<T> = { success: true; data: T } | { success: false; error: string };
