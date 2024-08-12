import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import {CircleAlert, CircleCheck, Loader} from 'lucide-react';
import prettyBytes from 'pretty-bytes';
import {useMemo} from 'react';

import {useMediaQuery} from '@/hooks/use-media-query';
import {MimeType} from '@/types/mime-type';
import {cn} from '@/utils/cn';

import {formatDate} from '../utils/format-date';
import {formatFileType} from '../utils/format-file-type';

dayjs.extend(relativeTime);

type FileMetadataProps = {
  fileSize: number;
  fileType: string | MimeType;
  fileUploadedAt?: Date;
  isPending?: boolean;
  isError?: boolean;
  isSuccess?: boolean;
};

export function FileMetadata({
  fileSize,
  fileType,
  fileUploadedAt,
  isPending,
  isError,
  isSuccess,
}: FileMetadataProps) {
  const isDesktop = useMediaQuery('(min-width: 768px)');

  const pending = isPending ?? false;
  const error = isError ?? false;
  const success = isSuccess ?? false;

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
          <span className='hidden sm:block'>Uploaded&nbsp;</span>
          <span className='truncate'>{formattedDate}</span>
        </>
      )}
      {(pending || error || success) && <span className='mx-2 sm:mx-3'>•</span>}
      <span
        className={cn(
          'flex items-center',
          isError && 'text-destructive',
          isSuccess && 'text-success',
        )}
      >
        {pending && (
          <>
            <Loader className='mr-1 inline h-4 w-4 animate-slow-spin' />
            <span>Processing...</span>
          </>
        )}
        {error && (
          <>
            <CircleAlert className='mr-1 inline h-4 w-4' />
            <span>Failed</span>
          </>
        )}
        {success && (
          <>
            <CircleCheck className='mr-1 h-4 w-4' />
            <span>Completed</span>
          </>
        )}
      </span>
    </span>
  );
}
