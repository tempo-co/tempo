import {useParams} from '@tanstack/react-router';
import {ChevronDown, FileScan, FileWarning} from 'lucide-react';
import {useEffect, useState} from 'react';

import {MimeTypeIcon} from '@/components/shared/mime-type-icon';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {Progress} from '@/components/ui/progress';
import {MimeType} from '@/types/mime-type';
import {cn} from '@/utils/cn';

import {useUploadBankStatement} from '../api/use-upload-bank-statement';
import {truncateFileName} from '../utils/truncate-file-name';
import {DeleteBankStatementDialog} from './delete-bank-statement/delete-bank-statement-dialog';
import {FileMetadata} from './file-metadata';
import {FileViewerDialog} from './file-viewer-dialog';
import {TransactionsTable} from './transaction-table';

type FilePreviewCardProps = {
  file: File;
};

export function FilePreviewCard({file}: FilePreviewCardProps) {
  const {accountId} = useParams({from: '/accounts/$accountId/bank-statements'});

  const [progressValue, setProgressValue] = useState(0);
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
        const randomFactor = 0.8 + Math.random();
        const incrementalProgress = (100 - prevProgress) * 0.02 * randomFactor;

        return Math.min(prevProgress + incrementalProgress, 99);
      });
    };
    const interval = setInterval(updateProgress, 50);

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
            {isError ? (
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
          <FileViewerDialog
            file={file}
            progressValue={progressValue}
            isPending={isPending}
            isError={isError}
            isSuccess={isSuccess}
          >
            <Button variant='ghost' size='icon'>
              <FileScan className='h-4 w-4' />
            </Button>
          </FileViewerDialog>
          {isSuccess && bankStatement && (
            <DeleteBankStatementDialog bankStatement={bankStatement}>
              <Button>Delete</Button>
            </DeleteBankStatementDialog>
          )}
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
