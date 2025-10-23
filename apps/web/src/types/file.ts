import {MimeType} from './mime-type';

export type FileEntity = {
  id: string;
  name: string;
  size: number;
  mimeType: MimeType;
};
