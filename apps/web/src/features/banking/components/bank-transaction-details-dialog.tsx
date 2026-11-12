import {BankTransaction} from '@tempo/contracts';
import {ArrowDownLeft, ArrowUpRight, CalendarDays, CreditCard} from 'lucide-react';
import {FileQuestion} from 'lucide-react';

import {CurrencyAmount} from '@/components/shared/currency-amount';
import {LoadErrorState, StateMessage} from '@/components/shared/state-message';
import {Button} from '@/components/ui/button';
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogCornerClose,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import {ScrollArea} from '@/components/ui/scroll-area';
import {Skeleton} from '@/components/ui/skeleton';
import {useIsOnline} from '@/hooks/use-connection';
import {HttpError} from '@/utils/api';
import {cn} from '@/utils/cn';
import {amountRoundsToZero} from '@/utils/format-currency';

import {useGetBankTransaction} from '../api/use-get-bank-transaction';
import {
  formatBankTransactionDate,
  formatBankTransactionType,
  resolveBankTransactionDisplayTitle,
} from '../utils/formatters';
import {BankTransactionDetails} from './bank-transaction-details';
import {MerchantHistoryLink} from './merchant-history-link';
import {MerchantLogoTile} from './merchant-logo-tile';

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
  const isOnline = useIsOnline();
  const {transaction, isPending, isFetching, isError, error, refetch} = useGetBankTransaction(
    transactionId,
    open,
  );
  const isNotFound = error instanceof HttpError && error.status === 404;
  const isLoading = isPending || (isFetching && !transaction);
  const title = transaction
    ? resolveBankTransactionDisplayTitle(transaction)
    : 'Transaction details';
  const internal = transaction?.cashFlowTreatment === 'INTERNAL';
  const incoming = transaction?.direction === 'INCOME';
  // Zero moved no money, so it shows no direction.
  const DirectionIcon =
    transaction && amountRoundsToZero(Number(transaction.amount), transaction.currency)
      ? null
      : incoming
        ? ArrowDownLeft
        : ArrowUpRight;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent
        data-testid='bank-transaction-inspector'
        className='flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-h-[86dvh] sm:max-w-2xl [&>button:last-child]:hidden'
      >
        <ResponsiveDialogCornerClose label='Close transaction details' />
        <ResponsiveDialogHeader className='shrink-0 grid-cols-[minmax(0,1fr)] border-b px-5 pt-5 pb-6 text-left sm:px-8 sm:pt-8 sm:pb-7'>
          <div className='flex min-w-0 items-center gap-3 pr-11'>
            {transaction && (
              <MerchantLogoTile transaction={transaction} className='h-10 w-10 shrink-0' />
            )}
            <ResponsiveDialogTitle className='min-w-0 text-section-title leading-snug wrap-anywhere'>
              {title}
            </ResponsiveDialogTitle>
          </div>
          <ResponsiveDialogDescription className='sr-only'>
            Payment summary and editable transaction details
          </ResponsiveDialogDescription>
          {transaction && (
            <div className='mt-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-2'>
              <div className='min-w-0 flex-1 basis-64'>
                <div className='flex min-w-0 items-center gap-2'>
                  {DirectionIcon && (
                    <DirectionIcon
                      aria-hidden='true'
                      data-testid='bank-transaction-detail-direction'
                      className={cn(
                        'size-5 shrink-0 text-muted-foreground',
                        incoming && !internal && 'text-success',
                      )}
                    />
                  )}
                  <p
                    data-testid='bank-transaction-detail-amount'
                    className={cn(
                      'min-w-0 numeric text-3xl leading-tight font-medium tracking-tight wrap-anywhere sm:text-4xl [&>span]:whitespace-normal',
                      incoming && !internal && 'text-success',
                    )}
                  >
                    <CurrencyAmount
                      amount={Number(transaction.amount)}
                      currency={transaction.currency}
                    />
                  </p>
                  <span className='ml-1 shrink-0 self-end pb-1 text-label text-muted-foreground'>
                    {transaction.currency}
                  </span>
                </div>
                <div className='mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground'>
                  <span className='inline-flex items-center gap-1.5'>
                    <CalendarDays className='size-4' aria-hidden='true' />
                    {transaction.transactionDate || transaction.bookingDate
                      ? formatBankTransactionDate(
                          transaction.transactionDate || transaction.bookingDate,
                        )
                      : 'Date unavailable'}
                  </span>
                  <span className='inline-flex items-center gap-1.5'>
                    <CreditCard className='size-4' aria-hidden='true' />
                    {transaction.financialEventType === 'CURRENCY_EXCHANGE'
                      ? 'Currency exchange'
                      : transaction.ownTransfer
                        ? 'Own transfer'
                        : formatBankTransactionType(transaction.transactionType)}
                  </span>
                </div>
              </div>
              <MerchantHistoryLink transaction={transaction} />
            </div>
          )}
        </ResponsiveDialogHeader>
        <ScrollArea
          type='auto'
          data-testid='bank-transaction-inspector-body'
          className='grid min-h-0 grid-rows-[minmax(0,1fr)] [&_[data-radix-scroll-area-viewport]>div]:block! [&>[data-radix-scroll-area-viewport]]:min-h-0 [&>[data-radix-scroll-area-viewport]]:overscroll-contain'
          aria-busy={isPending || isFetching}
        >
          {isLoading ? (
            <div role='status' aria-label='Loading bank transaction' className='p-5 sm:p-8'>
              <Skeleton className='h-72 w-full bg-card' />
            </div>
          ) : !transaction || (isError && isOnline) ? (
            <div className='p-5 sm:p-8'>
              {isNotFound ? (
                <StateMessage
                  size='section'
                  icon={FileQuestion}
                  title='Transaction not found'
                  description='It may have been removed, or the link is out of date.'
                >
                  <ResponsiveDialogClose asChild>
                    <Button variant='outline' size='sm'>
                      Close
                    </Button>
                  </ResponsiveDialogClose>
                </StateMessage>
              ) : (
                <LoadErrorState
                  size='section'
                  title="Couldn't load this transaction"
                  error={error}
                  onRetry={refetch}
                />
              )}
            </div>
          ) : (
            <BankTransactionDetails key={transaction.id} transaction={transaction} />
          )}
        </ScrollArea>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
