interface InlinedType {
  value: string;
}
declare global {
  interface MyGlobal {
    data: InlinedType;
  }
}

export {};
