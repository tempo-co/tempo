import prettyBytes from 'pretty-bytes';
import {useMemo} from 'react';

import {useMediaQuery} from '@/hooks/use-media-query';
import {MimeType} from '@/types/mime-type';

import {formatDate} from '../../utils/format-date';
import {formatFileType} from '../../utils/format-file-type';

type FileMetadataProps = {
  fileSize: number;
  fileType: string | MimeType;
  fileUploadedAt?: Date;
};

export function FileMetadata({fileSize, fileType, fileUploadedAt}: FileMetadataProps) {
  const isDesktop = useMediaQuery('(min-width: 768px)');

  const formattedFileType = useMemo(() => formatFileType(fileType), [fileType]);

  const formattedFileSize = useMemo(() => prettyBytes(Number(fileSize)), [fileSize]);
  const formattedDate = useMemo(
    () => (fileUploadedAt ? formatDate(fileUploadedAt, isDesktop) : undefined),
    [fileUploadedAt, isDesktop],
  );

  return (
    <span className='mt-1 flex items-center whitespace-nowrap text-sm text-muted-foreground'>
      <span>{formattedFileType}</span>
      <span className='mx-2 sm:mx-3'>•</span>
      <span>{formattedFileSize}</span>
      {fileUploadedAt && (
        <>
          <span className='mx-2 sm:mx-3'>•</span>
          <span className='hidden sm:block'>uploaded&nbsp;</span>
          <span className='truncate'>{formattedDate}</span>
        </>
      )}
    </span>
  );
}
