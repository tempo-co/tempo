import {MimeType} from './mime-type';

export type File = {
  id: string;
  name: string;
  size: number;
  type: MimeType;
};
