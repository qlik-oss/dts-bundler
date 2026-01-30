export type ParcelProps = {
  /** The DOM element or selector where the parcel will be mounted */
  mountPoint: HTMLElement | string;
  /** Props passed to the parcel */
  props?: Record<string, unknown>;
};
