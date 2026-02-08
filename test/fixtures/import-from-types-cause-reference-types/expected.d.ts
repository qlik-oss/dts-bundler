/// <reference types="fake-types-lib-2" />
/// <reference types="node" />

import { EventEmitter } from "events";
import type { Data } from "fake-types-lib-2.5";

export declare class MyEventEmitter extends EventEmitter {}
export interface ExtendedData extends Data {}
