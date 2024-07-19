import {Check, Loader} from 'lucide-react';
import prettyBytes from 'pretty-bytes';

import {cn} from '@/utils/cn';

type FileMetadataProps = {
  fileSize: File['size'];
  fileType: File['type'];
  isPending: boolean;
  progressMessage: string;
};

export function FileMetadata({fileSize, fileType, isPending, progressMessage}: FileMetadataProps) {
  return (
    <p className='mt-1 flex items-center text-sm text-muted-foreground'>
      <span>{prettyBytes(fileSize)}</span>
      <span className='mx-3'>•</span>
      <span>{fileType}</span>
      <span className='mx-3'>•</span>
      <div className={cn('flex items-center', !isPending && 'text-success')}>
        {isPending ? (
          <Loader className='mr-2 inline h-4 w-4 animate-slow-spin' />
        ) : (
          <Check className='mr-2 h-4 w-4' />
        )}
        <span>{progressMessage}</span>
      </div>
    </p>
  );
}
