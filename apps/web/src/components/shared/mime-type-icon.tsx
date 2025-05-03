import Csv from '@/assets/icons/file-type-icons/csv';
import File from '@/assets/icons/file-type-icons/file';
import Xls from '@/assets/icons/file-type-icons/xls';
import Xlsx from '@/assets/icons/file-type-icons/xlsx';
import {MimeType} from '@/types/mime-type';

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
      case MimeType.XLSX:
        return Xlsx;
      default:
        return File;
    }
  })();

  return <Icon className='h-6 w-6 fill-foreground' />;
}
