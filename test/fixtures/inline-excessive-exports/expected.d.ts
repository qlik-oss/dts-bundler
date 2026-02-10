interface InternalConfig {
  debug: boolean;
  timeout: number;
}
declare enum ResourceTypes {
  Document = "document",
  Spreadsheet = "spreadsheet",
  Image = "image",
}
export interface PublicAPI {
  config: InternalConfig;
  resourceType: ResourceTypes;
}
