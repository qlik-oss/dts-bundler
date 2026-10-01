type AllowedTypes = "json" | "number" | "boolean";
type QlikEmbedUI = string;
type PredefinedTypes = Partial<Record<QlikEmbedUI, Record<string, AllowedTypes>>>;
type StatementType = "statement";
type MixedType = "mixed";
const value = 1;
const mixedValue = 2;

export { type AllowedTypes, type PredefinedTypes, type QlikEmbedUI };
export type { StatementType };
export { type MixedType, mixedValue };
export { value };
export default {};
