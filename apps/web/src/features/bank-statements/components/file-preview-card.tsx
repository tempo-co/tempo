import {FileWarning} from 'lucide-react';

import {MimeTypeIcon} from '@/components/shared/mime-type-icon';
import {Card} from '@/components/ui/card';
import {BankStatement} from '@/types/bank-statement';
import {MimeType} from '@/types/mime-type';
import {cn} from '@/utils/cn';

import {truncateFileName} from '../utils/truncate-file-name';
import {FileActionsDropdown} from './file-actions-dropdown';
import {FileMetadata} from './file-metadata';

type FilePreviewCardProps = {
  file: File;
  bankStatement?: BankStatement;
  isPending: boolean;
  error: string | null;
  isSuccess: boolean;
};

export function FilePreviewCard({
  file,
  bankStatement,
  isPending,
  error,
  isSuccess,
}: FilePreviewCardProps) {
  return (
    <Card className={cn('flex flex-col p-4', error && 'border-destructive')}>
      <div className='flex items-center justify-between'>
        <div className='flex items-center'>
          <div className='mr-4 rounded-md bg-muted p-2'>
            {error ? (
              <FileWarning className='h-6 w-6' />
            ) : (
              <MimeTypeIcon mimeType={file.type as MimeType} />
            )}
          </div>
          <div>
            <p>{truncateFileName(file.name)}</p>
            <div className='flex items-center'>
              <FileMetadata
                fileSize={file.size}
                fileType={file.type}
                isPending={isPending}
                error={error}
                isSuccess={isSuccess}
              />
            </div>
          </div>
        </div>
        <FileActionsDropdown
          bankStatement={bankStatement}
          file={file}
          isPending={isPending}
          error={error}
          isSuccess={isSuccess}
        />
      </div>
    </Card>
  );
}
