import {useParams} from '@tanstack/react-router';
import {FileSpreadsheet, FileX2, Trash2, X} from 'lucide-react';
import {useEffect, useState} from 'react';

import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {Progress} from '@/components/ui/progress';
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from '@/components/ui/tooltip';
import {cn} from '@/utils/cn';

import {useUploadBankStatement} from '../api/use-upload-bank-statement';
import {FileMetadata} from './file-metadata';
import {FileViewerDialog} from './file-viewer-dialog';

type FilePreviewCardProps = {
  file: File;
};

export function FilePreviewCard({file}: FilePreviewCardProps) {
  const {accountId} = useParams({from: '/accounts/$accountId/bank-statements'});

  const [progressValue, setProgressValue] = useState(0);
  const [progressMessage, setProgressMessage] = useState('Uploading file...');

  const {mutate, isPending, isError, isSuccess} = useUploadBankStatement(accountId);

  useEffect(() => {
    const interval = setInterval(() => {
      setProgressValue((prevProgress) => {
        const increment =
          prevProgress < 50 ? 10 : prevProgress < 75 ? 5 : prevProgress < 99 ? 1 : 0;
        const newProgress = prevProgress + increment;
        if (newProgress < 30) {
          setProgressMessage('Parsing file...');
        } else if (newProgress < 50) {
          setProgressMessage('Categorizing transactions...');
        }
        return newProgress;
      });
    }, 1500);

    return () => clearInterval(interval);
  }, [isPending]);

  useEffect(() => {
    mutate(file);
  }, [mutate, file]);

  return (
    <Card className={cn('flex flex-col p-4', isError && 'border-destructive')}>
      <div className='flex items-center justify-between'>
        <div className='flex items-center'>
          <div className='mr-4 rounded-md bg-muted p-2'>
            {isError ? <FileX2 className='h-6 w-6' /> : <FileSpreadsheet className='h-6 w-6' />}
          </div>
          <div>
            <p>{file.name}</p>
            <FileMetadata
              fileSize={file.size}
              fileType={file.type}
              progressMessage={progressMessage}
              isPending={isPending}
              isError={isError}
              isSuccess={isSuccess}
            />
          </div>
        </div>
        <div className='flex gap-3'>
          <TooltipProvider delayDuration={200}>
            <FileViewerDialog
              file={file}
              progressMessage={progressMessage}
              isPending={isPending}
              isError={isError}
              isSuccess={isSuccess}
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant='ghost' size='icon' className='hover:bg-destructive-foreground'>
                  {isPending ? <X className='h-4 w-4' /> : <Trash2 className='h-4 w-4' />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {isPending ? <p>Cancel upload</p> : <p>Delete statement</p>}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
      {isPending && <Progress value={progressValue} className='mt-4 h-1' />}
    </Card>
  );
}
