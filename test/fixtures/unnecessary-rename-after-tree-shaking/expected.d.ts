interface Config {
  enabled: boolean;
}
export interface ServiceA {
  name: string;
}
export interface ServiceB {
  config: Config;
}
