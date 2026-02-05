export interface FileUploadModel {
  file: File;
  progress: number;
  status: "pending" | "uploading" | "done" | "error";
}
