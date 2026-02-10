// Entry file mimicking hub-parcels structure
// - Has declare global with interface
// - Uses types from inlined library
// - Only exports a few things directly
import type { LibConfig, LibHelper } from "fake-inlined-lib";

export type { FileUploadModel } from "./file-upload";

export type CustomContent = {
  name: string;
  props?: Record<string, unknown>;
};

declare global {
  interface QlikEmbedUIs {
    "hub-parcels/FileUpload": {
      props: FileUploadProps;
    };
    "hub-parcels/Home": {
      props: HomeProps;
    };
  }
}

interface FileUploadProps {
  config: LibConfig;
  onUpload: (file: File) => void;
}

interface HomeProps {
  helper: LibHelper;
  title: string;
}

export {};
