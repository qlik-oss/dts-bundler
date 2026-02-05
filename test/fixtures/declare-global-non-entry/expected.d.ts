export interface Local {
  value: string;
}
declare global {
  interface NonEntryGlobal {
    local: Local;
  }
}
