export type File = {
  id: string;
  buffer: Buffer;
  name: string;
  size: number;
  mimeType: string;
  uploadedAt: Date;
};
