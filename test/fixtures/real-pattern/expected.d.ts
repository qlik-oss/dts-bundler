interface LibConfig {
  enabled: boolean;
  timeout: number;
}
interface LibHelper {
  doSomething(): void;
}
interface FileUploadProps {
  config: LibConfig;
  onUpload: (file: File) => void;
}
interface HomeProps {
  helper: LibHelper;
  title: string;
}
export interface FileUploadModel {
  file: File;
  progress: number;
  status: "pending" | "uploading" | "done" | "error";
}
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

export {};
