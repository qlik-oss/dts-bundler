import type { LibConfig } from "fake-inlined-lib";

export interface PublicProps {
  config: LibConfig;
}

declare global {
  interface MyWidgets {
    "widget/config": {
      props: PublicProps;
    };
  }
}

export {};
