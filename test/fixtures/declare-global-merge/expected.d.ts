export interface FeatureA {
  name: string;
}
declare global {
  interface Window {
    featureA: FeatureA;
  }
}
export interface FeatureB {
  id: number;
}
declare global {
  interface Window {
    featureB: FeatureB;
  }
}

export {};
