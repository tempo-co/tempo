export type File = {
  id: string;
  buffer: Buffer;
  name: string;
  size: number;
  mimeType: MimeType;
  uploadedAt: Date;
};

export enum MimeType {
  XLS = 'application/vnd.ms-excel',
  CSV = 'text/csv',
}

export function getMimeTypeKey(value: MimeType): string {
  return Object.keys(MimeType)[Object.values(MimeType).indexOf(value)];
}
