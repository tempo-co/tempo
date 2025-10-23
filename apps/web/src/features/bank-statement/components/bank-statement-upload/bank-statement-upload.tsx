import {useParams} from '@tanstack/react-router';
import {Upload} from 'lucide-react';
import {useCallback, useEffect, useMemo, useRef} from 'react';
import {ErrorCode, FileRejection, useDropzone} from 'react-dropzone';
import {toast} from 'sonner';

import {Button} from '@/components/ui/button';
import {UploadIcon, UploadIconHandle} from '@/components/ui/upload-icon';
import {useMediaQuery} from '@/hooks/use-media-query';
import {MimeType} from '@/types/mime-type';
import {cn} from '@/utils/cn';

import {useUploadBankStatement} from '../../api/use-upload-bank-statement';
import {truncateFileName} from '../../utils/truncate-file-name';

const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const MAX_FILES = 10;
const ACCEPT_TYPES = Object.fromEntries(Object.values(MimeType).map((type) => [type, []]));

type BankStatementUploadInputProps = {
  setDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
};

export function BankStatementUploadInput({setDialogOpen}: BankStatementUploadInputProps) {
  const {bankAccountId} = useParams({from: '/bank-accounts/$bankAccountId/bank-statements/'});
  const {mutate: uploadFile} = useUploadBankStatement(bankAccountId);
  const formattedFileTypes = useMemo(() => Object.keys(MimeType).join(', '), []);

  const isDesktop = useMediaQuery('(min-width: 768px)');

  const onDrop = useCallback(
    (acceptedFiles: File[], fileRejections: FileRejection[]) => {
      if (acceptedFiles.length > 0) {
        setDialogOpen(false);
      }

      acceptedFiles.forEach((file) => {
        uploadFile(file);
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
                description: `Maximum file size: ${MAX_FILE_SIZE_MB} MB`,
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
    [formattedFileTypes, setDialogOpen, uploadFile],
  );

  const dropzone = useDropzone({
    onDrop,
    maxSize: MAX_FILE_SIZE_BYTES,
    maxFiles: MAX_FILES,
    accept: ACCEPT_TYPES,
  });

  const uploadIconRef = useRef<UploadIconHandle>(null);

  useEffect(() => {
    if (dropzone.isDragAccept) {
      uploadIconRef.current?.startAnimation();
    } else if (!dropzone.isDragActive) {
      uploadIconRef.current?.stopAnimation();
    }
  }, [dropzone.isDragAccept, dropzone.isDragActive]);

  if (isDesktop) {
    return (
      <>
        <div
          {...dropzone.getRootProps()}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 text-center transition-colors',
            dropzone.isDragActive ? 'border-primary bg-accent' : 'border-border hover:bg-accent',
          )}
        >
          <input {...dropzone.getInputProps()} />
          <UploadIcon
            ref={uploadIconRef}
            className={cn('mb-2', dropzone.isDragActive ? 'text-primary' : 'text-muted-foreground')}
          />
          {dropzone.isDragActive ? (
            <p>Drop the files here...</p>
          ) : (
            <p>Drag & drop files here, or click to select</p>
          )}
        </div>
        <div className='flex justify-between text-xs text-muted-foreground'>
          <p>
            Supported file types: <span className='text-foreground'>{formattedFileTypes}</span>
          </p>
          <p>
            Maximum file size: <span className='text-foreground'>{MAX_FILE_SIZE_MB} MB</span>
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <input {...dropzone.getInputProps()} className='hidden' />
      <Button onClick={dropzone.open}>
        <Upload className='h-4 w-4' />
        Upload Statement
      </Button>
    </>
  );
}
