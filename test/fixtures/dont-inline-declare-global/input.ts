// should be run with inlineDeclareGlobals=false,
// to ensure that global declarations are not inlined
declare global {
  interface ArrayConstructor {
    field: string;
  }
}

export const field = Array.field;
