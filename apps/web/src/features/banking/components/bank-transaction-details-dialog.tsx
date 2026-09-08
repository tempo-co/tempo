import {FileQuestion, RefreshCw, X} from 'lucide-react';

import {EmptyState} from '@/components/shared/layout/app-empty-state';
import {Button} from '@/components/ui/button';
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import {ScrollArea} from '@/components/ui/scroll-area';
import {Skeleton} from '@/components/ui/skeleton';
import {HttpError} from '@/utils/api';

import {useGetBankTransaction} from '../api/use-get-bank-transaction';
import {BankTransaction} from '../types/bank-transaction';
import {BankTransactionDetails} from './bank-transaction-details';

type BankTransactionDetailsDialogProps = {
  transactionId: BankTransaction['id'];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function BankTransactionDetailsDialog({
  transactionId,
  open,
  onOpenChange,
}: BankTransactionDetailsDialogProps) {
  const {transaction, isPending, isFetching, isError, error, refetch} = useGetBankTransaction(
    transactionId,
    open,
  );
  const isNotFound = error instanceof HttpError && error.status === 404;
  const transactionTitle = transaction
    ? transaction.description || transaction.counterpartyName || 'Transaction'
    : 'Transaction details';

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent
        data-testid='bank-transaction-inspector'
        className='flex h-[min(90dvh,56rem)] max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-h-[90vh] sm:max-w-4xl [&>button:last-child]:hidden'
      >
        <ResponsiveDialogClose
          aria-label='Close transaction details'
          className='absolute right-3 top-3 z-20 inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
        >
          <X className='h-4 w-4' aria-hidden='true' />
          <span className='sr-only'>Close transaction details</span>
        </ResponsiveDialogClose>
        <ResponsiveDialogHeader className='shrink-0 border-b px-5 pb-4 pr-16 pt-5 text-left sm:px-6'>
          <ResponsiveDialogTitle className='break-words text-xl leading-tight sm:text-2xl'>
            {transactionTitle}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription className='mt-1'>
            {transaction ? 'Bank transaction' : 'Transaction details'}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <ScrollArea
          type='always'
          data-testid='bank-transaction-inspector-body'
          className='min-h-0 flex-1'
          aria-busy={isPending || isFetching}
        >
          {isPending || isFetching ? (
            <div role='status' aria-label='Loading bank transaction' className='p-5 sm:p-6'>
              <Skeleton className='h-80 w-full rounded-lg bg-card sm:h-96' />
            </div>
          ) : isError || !transaction ? (
            <div role='alert' className='p-5 sm:p-6'>
              {isNotFound ? (
                <EmptyState
                  icon={FileQuestion}
                  title='Transaction not found'
                  description='This transaction may have been removed or the details may be out of date.'
                >
                  <ResponsiveDialogClose asChild>
                    <Button variant='outline' className='min-h-11'>
                      Close
                    </Button>
                  </ResponsiveDialogClose>
                </EmptyState>
              ) : (
                <EmptyState
                  icon={RefreshCw}
                  title='Could not load bank transaction'
                  description='The transaction service did not respond. Try again in a moment.'
                >
                  <Button variant='outline' onClick={() => void refetch()} className='min-h-11'>
                    Try again
                  </Button>
                </EmptyState>
              )}
            </div>
          ) : (
            <BankTransactionDetails transaction={transaction} />
          )}
        </ScrollArea>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
