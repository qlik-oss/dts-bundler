export interface LibConfig {
  enabled: boolean;
  timeout: number;
}
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
