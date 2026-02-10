export interface InternalConfig {
  debug: boolean;
  timeout: number;
}

export enum ResourceTypes {
  Document = "document",
  Spreadsheet = "spreadsheet",
  Image = "image",
}
