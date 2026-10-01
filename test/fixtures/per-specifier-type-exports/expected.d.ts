type AllowedTypes = "json" | "number" | "boolean";
type QlikEmbedUI = string;
type PredefinedTypes = Partial<Record<QlikEmbedUI, Record<string, AllowedTypes>>>;
type StatementType = "statement";
type MixedType = "mixed";
export declare const _default: {};
export declare const mixedValue = 2;
export declare const value = 1;

export type {
  AllowedTypes,
  MixedType,
  PredefinedTypes,
  QlikEmbedUI,
  StatementType,
};

export { _default as default };
