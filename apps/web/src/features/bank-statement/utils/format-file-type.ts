import mime from 'mime-types';

import {MimeType, getMimeTypeKey} from '@/types/mime-type';

export const formatFileType = (fileType: string | MimeType): string => {
  if (typeof fileType === 'string') {
    const extension = mime.extension(fileType);
    return typeof extension === 'string' ? extension.toUpperCase() : fileType.toUpperCase();
  }
  const mimeTypeKey = getMimeTypeKey(fileType);
  return typeof mimeTypeKey === 'string' ? mimeTypeKey : '';
};
