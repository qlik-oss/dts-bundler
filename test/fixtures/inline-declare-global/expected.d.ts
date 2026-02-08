declare global {
  interface SymbolConstructor {
    readonly observable: symbol;
  }
}
export declare const observable: typeof observable | "@@observable";

export {};
