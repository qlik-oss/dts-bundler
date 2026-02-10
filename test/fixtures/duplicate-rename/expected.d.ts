type Status = "pending" | "active" | "completed";
type Status$1 = "draft" | "published" | "archived";
export interface ServiceA {
  status: Status;
}
export interface ServiceB {
  status: Status$1;
}
