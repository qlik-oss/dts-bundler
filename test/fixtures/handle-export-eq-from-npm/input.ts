import { EventEmitter } from "events";
import { SomeCoolInterface } from "package-with-export-eq";
import { NamedDeclaration } from "typescript";

export class StoppableEventEmitter extends EventEmitter {
  public emitStoppableEvent(error: Error): this {
    return this;
  }
}

export type ExportType = SomeCoolInterface | NamedDeclaration | string;
