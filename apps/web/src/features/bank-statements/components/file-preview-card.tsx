import {useParams} from '@tanstack/react-router';
import {ChevronDown, FileSpreadsheet, FileX2, Trash2, X} from 'lucide-react';
import {useEffect, useState} from 'react';

import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {Progress} from '@/components/ui/progress';
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from '@/components/ui/tooltip';
import {cn} from '@/utils/cn';

import {useUploadBankStatement} from '../api/use-upload-bank-statement';
import {truncateFileName} from '../utils/truncate-file-name';
import {FileMetadata} from './file-metadata';
import {FileViewerDialog} from './file-viewer-dialog';
import {TransactionsTable} from './transaction-table';

type FilePreviewCardProps = {
  file: File;
};

export function FilePreviewCard({file}: FilePreviewCardProps) {
  const {accountId} = useParams({from: '/accounts/$accountId/bank-statements'});

  const [progressValue, setProgressValue] = useState(0);
  const [progressMessage, setProgressMessage] = useState('Uploading file...');
  const [showTransactions, setShowTransactions] = useState(false);
  const [shouldRenderTransactions, setShouldRenderTransactions] = useState(false);

  const toggleTransactions = () => {
    if (showTransactions) {
      setShowTransactions(false);
      setTimeout(() => setShouldRenderTransactions(false), 100);
    } else {
      setShouldRenderTransactions(true);
      setTimeout(() => setShowTransactions(true), 0);
    }
  };

  const {bankStatement, mutate, isPending, isError, isSuccess} = useUploadBankStatement(accountId);

  useEffect(() => {
    const updateProgress = () => {
      setProgressValue((prevProgress) => {
        const randomFactor = 0.6 + Math.random();
        const progress = Math.min(prevProgress + (100 - prevProgress) * 0.01 * randomFactor, 99.9);

        if (progress < 15) {
          setProgressMessage('Uploading file...');
        } else if (progress < 30) {
          setProgressMessage('Parsing file...');
        } else if (progress < 40) {
          setProgressMessage('Categorizing transactions...');
        }
        return progress;
      });
    };
    const interval = setInterval(updateProgress, 100);

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
            <p>{truncateFileName(file.name)}</p>
            <div className='flex items-center'>
              <FileMetadata
                fileSize={file.size}
                fileType={file.type}
                progressMessage={progressMessage}
                isPending={isPending}
                isError={isError}
                isSuccess={isSuccess}
              />
              {isSuccess && bankStatement && (
                <div className='mt-1'>
                  <span className='mx-3 text-muted-foreground'>•</span>
                  <Button variant='link' className='h-0 p-0' onClick={toggleTransactions}>
                    <span className='text-foreground'>
                      {showTransactions ? 'Hide transactions' : 'View transactions'}
                    </span>
                    <ChevronDown
                      className={cn(
                        'ml-1 h-4 w-4 text-foreground transition-transform',
                        showTransactions && 'rotate-180',
                      )}
                    />
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className='flex gap-3'>
          <TooltipProvider delayDuration={200}>
            <FileViewerDialog
              file={file}
              progressMessage={progressMessage}
              progressValue={progressValue}
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
      <div
        className={cn('overflow-hidden transition-all duration-100 ease-in-out', {
          'max-h-0': !showTransactions,
          'max-h-[40rem]': showTransactions,
          'mt-4': shouldRenderTransactions,
        })}
      >
        {isSuccess && bankStatement && shouldRenderTransactions && (
          <TransactionsTable transactions={bankStatement.transactions} />
        )}
      </div>
    </Card>
  );
}
