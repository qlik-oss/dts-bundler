import { InternalConfig, ResourceTypes } from "./types";

export interface PublicAPI {
  config: InternalConfig;
  resourceType: ResourceTypes;
}
