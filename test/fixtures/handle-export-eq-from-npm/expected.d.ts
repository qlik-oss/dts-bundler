import { EventEmitter } from "events";
import type { SomeCoolInterface } from "package-with-export-eq";
import type { NamedDeclaration } from "typescript";

export declare class StoppableEventEmitter extends EventEmitter {
  emitStoppableEvent(error: Error): this;
}
export type ExportType = SomeCoolInterface | NamedDeclaration | string;
