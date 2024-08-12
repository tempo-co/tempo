import {FileUp} from 'lucide-react';
import {useCallback, useMemo, useState} from 'react';
import {ErrorCode, FileRejection, useDropzone} from 'react-dropzone';
import {toast} from 'sonner';

import {Button} from '@/components/ui/button';
import {useMediaQuery} from '@/hooks/use-media-query';
import {MimeType} from '@/types/mime-type';
import {cn} from '@/utils/cn';

import {truncateFileName} from '../utils/truncate-file-name';
import {FilePreviewCard} from './file-preview-card';

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const acceptTypes = Object.fromEntries(Object.values(MimeType).map((type) => [type, []]));

export function BankStatementUploadInput() {
  const [files, setFiles] = useState<File[]>([]);

  const isDesktop = useMediaQuery('(min-width: 768px)');

  const formattedFileTypes = useMemo(() => Object.keys(MimeType).join(', '), []);

  const onDrop = useCallback(
    (acceptedFiles: File[], fileRejections: FileRejection[]) => {
      setFiles((prevFiles) => [...prevFiles, ...acceptedFiles]);

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
    [formattedFileTypes],
  );

  const dropzone = useDropzone({
    onDrop,
    maxSize: MAX_FILE_SIZE,
    accept: acceptTypes,
    maxFiles: 10,
  });

  return (
    <>
      <h1>Upload bank statements</h1>
      {isDesktop ? (
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
            <p>
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
            </p>
          </div>
        </div>
      ) : (
        <Button onClick={dropzone.open} className='w-full'>
          Upload files
        </Button>
      )}
      <div className='mb-6 mt-2 flex justify-between text-muted-foreground'>
        <p>
          Supported file types: <span className='text-foreground'>{formattedFileTypes}</span>
        </p>
        <p>
          Maximum file size:{' '}
          <span className='text-foreground'>{MAX_FILE_SIZE / (1024 * 1024)} MB</span>
        </p>
      </div>
      {files.length > 0 && (
        <div className='grid gap-4'>
          {files.map((file) => (
            <FilePreviewCard key={file.lastModified} file={file} />
          ))}
        </div>
      )}
    </>
  );
}
