export interface OpenAppSessionProps {
  url: string;
}
export interface AppSession {
  sessionId: string;
}
export declare const _default: {};
export interface QixRuntimeApiV1 {
  openAppSession: (appSessionProps: OpenAppSessionProps) => AppSession;
}

export { _default as default };
