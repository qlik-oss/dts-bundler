import type { AppSession, OpenAppSessionProps } from "@scoped/mock/qix";

export interface QixRuntimeApiV1 {
  openAppSession: (appSessionProps: OpenAppSessionProps) => AppSession;
}

export default {};
