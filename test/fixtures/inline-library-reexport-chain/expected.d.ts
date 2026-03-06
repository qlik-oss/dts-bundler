type OpenAppSessionProps = {
  appId: string;
};
type AppSession = {
  sessionId: string;
};
export declare const _default: {};
export interface QixRuntimeApiV1 {
  openAppSession: (appSessionProps: OpenAppSessionProps) => AppSession;
}

export { AppSession, OpenAppSessionProps };

export { _default as default };
