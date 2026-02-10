export interface FeatureA {
  name: string;
}

declare global {
  interface Window {
    featureA: FeatureA;
  }
}
