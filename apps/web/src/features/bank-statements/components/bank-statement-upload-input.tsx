import {useParams} from '@tanstack/react-router';
import {FileUp} from 'lucide-react';
import {useCallback, useMemo} from 'react';
import {useDropzone} from 'react-dropzone';

import {useUploadBankStatement} from '../api/use-upload-bank-statement';
import {FileTypes} from '../types/file-types';
import {FilePreviewCard} from './file-preview-card';

const MAX_FILE_SIZE = 10 * 1024 * 1024;

export function BankStatementUploadInput() {
  const {accountId} = useParams({from: '/accounts/$accountId/bank-statements'});
  const {mutate, isPending, isError} = useUploadBankStatement(accountId);

  const onDrop = useCallback((files: File[]) => files[0] && mutate(files[0]), [mutate]);
  const dropzone = useDropzone({onDrop, maxSize: MAX_FILE_SIZE});

  const formattedFileTypes = useMemo(() => Object.keys(FileTypes).join(', '), []);

  if (isError) {
    return <p>Error uploading the file. Please try again.</p>;
  }

  return (
    <>
      <div
        {...dropzone.getRootProps()}
        className='flex h-40 cursor-pointer select-none items-center justify-center rounded-md border-2 border-dashed border-border transition-all hover:bg-accent'
      >
        <input {...dropzone.getInputProps()} />
        <div className='flex flex-col items-center'>
          {dropzone.isDragAccept ? (
            <>
              <FileUp className='mb-2 h-10 w-10 animate-bounce text-muted-foreground' />
              <p>Drop the file here!</p>
            </>
          ) : (
            <>
              <FileUp className='mb-2 h-10 w-10 text-muted-foreground' />
              <p>
                <span className='font-semibold'>Choose a file</span> or drag and drop it here
              </p>
            </>
          )}
        </div>
      </div>
      <div className='mb-6 mt-2 flex justify-between text-muted-foreground'>
        <p>Supported formats: {formattedFileTypes}</p>
        <p>Maximum file size: {MAX_FILE_SIZE / (1024 * 1024)} MB</p>
      </div>
      {dropzone.acceptedFiles.length > 0 &&
        dropzone.acceptedFiles.map((file) => (
          <FilePreviewCard key={file.lastModified} file={file} isPending={isPending} />
        ))}
    </>
  );
}
