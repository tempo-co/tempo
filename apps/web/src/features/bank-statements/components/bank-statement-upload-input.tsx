import {FileUp} from 'lucide-react';
import {useCallback, useMemo, useState} from 'react';
import {ErrorCode, FileRejection, useDropzone} from 'react-dropzone';
import {toast} from 'sonner';

import {cn} from '@/utils/cn';

import {FileTypes} from '../types/file-types';
import {truncateFileName} from '../utils/truncate-file-name';
import {FilePreviewCard} from './file-preview-card';

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const acceptTypes = Object.fromEntries(Object.values(FileTypes).map((type) => [type, []]));

export function BankStatementUploadInput() {
  const [files, setFiles] = useState<File[]>([]);

  const formattedFileTypes = useMemo(() => Object.keys(FileTypes).join(', '), []);

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
      <div
        {...dropzone.getRootProps()}
        className={cn(
          'flex h-40 cursor-pointer select-none items-center justify-center rounded-md border-2 border-dashed border-border transition-all hover:bg-accent',
          dropzone.isDragActive && 'bg-accent',
        )}
      >
        <input {...dropzone.getInputProps()} />
        <div className='flex flex-col items-center'>
          <FileUp
            className={cn(
              'mb-2 h-8 w-8 text-muted-foreground',
              dropzone.isDragAccept && 'animate-bounce',
            )}
          />
          <p>
            {dropzone.isDragAccept ? (
              'Drop the file here!'
            ) : (
              <>
                <span className='font-semibold'>Browse files</span> or drag and drop
              </>
            )}
          </p>
        </div>
      </div>
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
