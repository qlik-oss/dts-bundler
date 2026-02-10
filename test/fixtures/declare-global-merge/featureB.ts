export interface FeatureB {
  id: number;
}

declare global {
  interface Window {
    featureB: FeatureB;
  }
}
