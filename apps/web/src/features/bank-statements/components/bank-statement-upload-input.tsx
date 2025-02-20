import {useParams} from '@tanstack/react-router';
import {PaginationState} from '@tanstack/react-table';
import {FileUp} from 'lucide-react';
import {useCallback, useMemo} from 'react';
import {ErrorCode, FileRejection, useDropzone} from 'react-dropzone';
import {toast} from 'sonner';

import {Button} from '@/components/ui/button';
import {ScrollArea} from '@/components/ui/scroll-area';
import {Separator} from '@/components/ui/separator';
import {useMediaQuery} from '@/hooks/use-media-query';
import {MimeType} from '@/types/mime-type';
import {cn} from '@/utils/cn';

import {useUploadBankStatement} from '../api/use-upload-bank-statement';
import {FileState} from '../types/file-state';
import {truncateFileName} from '../utils/truncate-file-name';
import {FilePreviewCard} from './file-preview-card';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const acceptTypes = Object.fromEntries(Object.values(MimeType).map((type) => [type, []]));

type BankStatementUploadInputProps = {
  pagination: PaginationState;
  files: FileState[];
  setFiles: React.Dispatch<React.SetStateAction<FileState[]>>;
};

export function BankStatementUploadInput({
  pagination,
  files,
  setFiles,
}: BankStatementUploadInputProps) {
  const {accountId} = useParams({from: '/accounts/$accountId/bank-statements/'});

  const isDesktop = useMediaQuery('(min-width: 768px)');
  const formattedFileTypes = useMemo(() => Object.keys(MimeType).join(', '), []);
  const {upload} = useUploadBankStatement(accountId, pagination, setFiles);

  const onDrop = useCallback(
    (acceptedFiles: File[], fileRejections: FileRejection[]) => {
      acceptedFiles.forEach((file) => {
        upload(file);
      });

      fileRejections.forEach(({file, errors}) => {
        errors.forEach((error) => {
          switch (error.code as ErrorCode) {
            case ErrorCode.FileInvalidType:
              toast.error(`Invalid file type for '${truncateFileName(file.name)}'`, {
                description: `Supported file types: ${formattedFileTypes}`,
              });
              break;
            case ErrorCode.FileTooLarge:
              toast.error(`File too large for '${truncateFileName(file.name)}'`, {
                description: `Maximum file size: ${MAX_FILE_SIZE / (1024 * 1024)} MB`,
              });
              break;
            case ErrorCode.TooManyFiles:
              toast.error('Too many files uploaded', {
                description: 'Please upload a maximum of 10 files at a time.',
              });
              break;
            default:
              toast.error('An error occurred while uploading', {
                description: 'Please try again.',
              });
              break;
          }
        });
      });
    },
    [formattedFileTypes, upload],
  );

  const dropzone = useDropzone({
    onDrop,
    maxSize: MAX_FILE_SIZE,
    accept: acceptTypes,
    maxFiles: 10,
  });

  if (isDesktop) {
    return (
      <>
        <div
          {...dropzone.getRootProps()}
          className={cn(
            'flex h-52 cursor-pointer select-none items-center justify-center rounded-md border-2 border-dashed border-border transition-all hover:bg-accent',
            dropzone.isDragActive && 'bg-accent',
          )}
        >
          <input {...dropzone.getInputProps()} />
          <div className='flex flex-col items-center'>
            <FileUp
              className={cn(
                'h-8 w-8 text-muted-foreground',
                dropzone.isDragAccept && 'animate-bounce',
              )}
            />
            <div>
              {dropzone.isDragAccept ? (
                'Drop the file here!'
              ) : (
                <div className='mt-2 flex flex-col items-center'>
                  <p>Drag & Drop to upload</p>
                  <div className='flex items-center'>
                    <span>or&nbsp;</span>
                    <Button variant='link' className='h-0 p-0 text-base'>
                      Browse files
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className='flex justify-between text-muted-foreground'>
          <p>
            Supported file types: <span className='text-foreground'>{formattedFileTypes}</span>
          </p>
          <p>
            Maximum file size:{' '}
            <span className='text-foreground'>{MAX_FILE_SIZE / (1024 * 1024)} MB</span>
          </p>
        </div>
        {files.length > 0 && (
          <>
            <Separator />
            <ScrollArea className='max-h-80' type='auto'>
              <div className={cn('grid gap-4', files.length > 3 && 'mr-3')}>
                {files.map(({file, isPending, error, isSuccess, bankStatement}) => (
                  <FilePreviewCard
                    key={file.name}
                    file={file}
                    isPending={isPending}
                    error={error}
                    isSuccess={isSuccess}
                    bankStatement={bankStatement}
                  />
                ))}
              </div>
            </ScrollArea>
          </>
        )}
      </>
    );
  }

  return (
    <>
      <input {...dropzone.getInputProps()} className='hidden' />
      <Button onClick={dropzone.open} className='w-full'>
        Upload bank statement
      </Button>
    </>
  );
}
