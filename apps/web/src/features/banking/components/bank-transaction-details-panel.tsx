import {BankTransaction} from '@wisp/contracts';
import {ArrowDownLeft, ArrowUpRight, CalendarDays, CreditCard, FileQuestion, X} from 'lucide-react';
import {type ReactNode, useEffect, useRef, useState} from 'react';

import {CurrencyAmount} from '@/components/shared/currency-amount';
import {LoadErrorState, StateMessage} from '@/components/shared/state-message';
import {Button} from '@/components/ui/button';
import {ScrollArea} from '@/components/ui/scroll-area';
import {Skeleton} from '@/components/ui/skeleton';
import {useIsOnline} from '@/hooks/use-connection';
import {HttpError} from '@/utils/api';
import {cn} from '@/utils/cn';
import {amountRoundsToZero, formatCurrency} from '@/utils/format-currency';

import {useGetBankTransaction} from '../api/use-get-bank-transaction';
import {
  formatBankTransactionDate,
  formatBankTransactionType,
  resolveBankTransactionDisplayTitle,
} from '../utils/formatters';
import {type CategoryDraft, CategoryDraftContext} from './bank-transaction-category-draft';
import {BankTransactionCategoryImpactStep} from './bank-transaction-category-impact';
import {BankTransactionDetails} from './bank-transaction-details';
import {MerchantHistoryLink} from './merchant-history-link';
import {MerchantLogoTile} from './merchant-logo-tile';

type BankTransactionDetailsPanelProps = {
  transactionId: BankTransaction['id'];
  onClose: () => void;
  /** The heading's element: the phone sheet names its dialog with it. */
  renderTitle?: (title: ReactNode) => ReactNode;
  /** Moves focus to the heading when the panel opens, so the keyboard continues inside it. */
  focusOnOpen?: boolean;
};

/**
 * One transaction's details: its payment summary over the editable facts. The Transactions page shows it in the
 * right rail on desktop and in a bottom sheet on phones. Choosing a category that would move other payments turns
 * the whole panel into the "update other transactions" step until it is saved or cancelled.
 */
export function BankTransactionDetailsPanel({
  transactionId,
  onClose,
  renderTitle = (title) => title,
  focusOnOpen = false,
}: BankTransactionDetailsPanelProps) {
  const isOnline = useIsOnline();
  const {transaction, isPending, isFetching, isError, error, refetch} = useGetBankTransaction(
    transactionId,
    true,
  );
  const [draft, setDraft] = useState<CategoryDraft | null>(null);
  const [shownId, setShownId] = useState(transactionId);
  // Another row opened in the panel drops a step started on the previous one.
  if (shownId !== transactionId) {
    setShownId(transactionId);
    setDraft(null);
  }
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusOnOpen) headingRef.current?.focus({preventScroll: true});
  }, [focusOnOpen, transactionId]);

  const isNotFound = error instanceof HttpError && error.status === 404;
  const isLoading = isPending || (isFetching && !transaction);
  const title = transaction
    ? resolveBankTransactionDisplayTitle(transaction)
    : 'Transaction details';
  const internal = transaction?.cashFlowTreatment === 'INTERNAL';
  const incoming = transaction?.direction === 'INCOME';
  // Past twelve characters ("-€123,456.78") the amount steps down in a narrow rail or sheet, so it stays on one line.
  // Text enlarged beyond that still wraps rather than spill out.
  const longAmount =
    transaction !== undefined &&
    formatCurrency(Number(transaction.amount), transaction.currency).length > 12;
  // Zero moved no money, so it shows no direction.
  const DirectionIcon =
    transaction && amountRoundsToZero(Number(transaction.amount), transaction.currency)
      ? null
      : incoming
        ? ArrowDownLeft
        : ArrowUpRight;

  if (draft && transaction) {
    return (
      <BankTransactionCategoryImpactStep
        transaction={transaction}
        draft={draft}
        onDone={() => setDraft(null)}
      />
    );
  }

  return (
    <CategoryDraftContext.Provider value={setDraft}>
      <div className='flex min-h-0 flex-1 flex-col'>
        <header className='relative shrink-0 border-b px-5 pt-5 pb-5'>
          <Button
            variant='ghost'
            size='icon'
            className='absolute top-3 right-3 size-11 text-muted-foreground'
            aria-label='Close transaction details'
            onClick={onClose}
          >
            <X aria-hidden='true' />
          </Button>
          <div className='flex min-w-0 items-center gap-3 pr-11'>
            {transaction && (
              <MerchantLogoTile transaction={transaction} className='h-10 w-10 shrink-0' />
            )}
            {renderTitle(
              <h2
                ref={headingRef}
                tabIndex={-1}
                className='min-w-0 text-section-title leading-snug wrap-anywhere focus-visible:outline-none'
              >
                {title}
              </h2>,
            )}
          </div>
          {transaction && (
            <div className='@container mt-5 grid gap-3'>
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
                    'min-w-0 numeric text-3xl leading-tight font-medium tracking-tight wrap-anywhere [&>span]:whitespace-normal',
                    longAmount && 'text-xl @[18rem]:text-2xl @[24rem]:text-3xl',
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
              <div className='flex flex-wrap items-center gap-x-4 gap-y-2 text-body-small text-muted-foreground'>
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
              <MerchantHistoryLink transaction={transaction} />
            </div>
          )}
        </header>
        <ScrollArea
          type='auto'
          data-testid='bank-transaction-inspector-body'
          className='grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] [&_[data-radix-scroll-area-viewport]>div]:block! [&>[data-radix-scroll-area-viewport]]:min-h-0 [&>[data-radix-scroll-area-viewport]]:overscroll-contain'
          aria-busy={isPending || isFetching}
        >
          {isLoading ? (
            <div role='status' aria-label='Loading bank transaction' className='p-5'>
              <Skeleton className='h-72 w-full bg-muted' />
            </div>
          ) : !transaction || (isError && isOnline) ? (
            <div className='p-5'>
              {isNotFound ? (
                <StateMessage
                  size='section'
                  icon={FileQuestion}
                  title='Transaction not found'
                  description='It may have been removed, or the link is out of date.'
                >
                  <Button variant='outline' size='sm' onClick={onClose}>
                    Close
                  </Button>
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
      </div>
    </CategoryDraftContext.Provider>
  );
}
