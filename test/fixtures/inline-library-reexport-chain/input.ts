import type { AppSession, OpenAppSessionProps } from "@testlib/api/qix";

export interface QixRuntimeApiV1 {
  openAppSession: (appSessionProps: OpenAppSessionProps) => AppSession;
}

export { AppSession, OpenAppSessionProps };

export default {};
