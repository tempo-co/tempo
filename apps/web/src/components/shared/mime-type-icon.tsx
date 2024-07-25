import {MimeType} from '@/types/file';

import Csv from './file-types-icons/csv';
import File from './file-types-icons/file';
import Xls from './file-types-icons/xls';

type MimeTypeIconProps = {
  mimeType: MimeType;
};

export function MimeTypeIcon({mimeType}: MimeTypeIconProps) {
  const Icon = (() => {
    switch (mimeType) {
      case MimeType.CSV:
        return Csv;
      case MimeType.XLS:
        return Xls;
      default:
        return File;
    }
  })();

  return <Icon className='h-6 w-6 fill-foreground' />;
}
