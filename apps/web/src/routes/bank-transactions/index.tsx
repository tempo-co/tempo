import {Link, createFileRoute, stripSearchParams, useNavigate} from '@tanstack/react-router';
import {zodValidator} from '@tanstack/zod-adapter';
import {BANK_TRANSACTION_SEARCH_MAX_LENGTH, type BankTransactionTotals} from '@tempo/contracts';
import {CircleAlert, Search} from 'lucide-react';
import {Fragment, useEffect, useState} from 'react';

import {AppBodyLayout} from '@/components/shared/layout/app-body';
import {LoadMore} from '@/components/shared/load-more';
import {LoadingBar} from '@/components/shared/loading-bar';
import {LoadErrorState} from '@/components/shared/state-message';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {useBankTransactionLedger} from '@/features/banking/api/use-bank-transaction-ledger';
import {BankTransactionDateFilter} from '@/features/banking/components/bank-transaction-date-filter';
import {BankTransactionDetailsDialog} from '@/features/banking/components/bank-transaction-details-dialog';
import {
  NoMatchingTransactions,
  NoTransactionsYet,
} from '@/features/banking/components/bank-transaction-empty-states';
import {
  BankTransactionFilterChips,
  BankTransactionReviewToggle,
} from '@/features/banking/components/bank-transaction-filter-chips';
import {BankTransactionFilters} from '@/features/banking/components/bank-transaction-filters';
import {BankTransactionLedger} from '@/features/banking/components/bank-transaction-ledger';
import {BankTransactionSortMenu} from '@/features/banking/components/bank-transaction-sort-menu';
import {
  BANK_TRANSACTION_FILTER_KEYS,
  bankTransactionRouteSearchSchema,
} from '@/features/banking/types/bank-transaction';
import {
  Bone,
  LoadingLabel,
  TextBone,
  TileRowsSkeleton,
} from '@/features/dashboard/components/loading';
import {formatMoney, toCents} from '@/features/dashboard/utils/money';
import {missingAmountsLabel} from '@/features/reporting-currency/utils/currency-names';
import {useBankTransactionInspector} from '@/hooks/use-bank-transaction-inspector';
import {cn} from '@/utils/cn';
import {handleAuthenticatedRedirect} from '@/utils/handle-redirect';
import {savedDataStatus} from '@/utils/query-status';

export const Route = createFileRoute('/bank-transactions/')({
  component: BankTransactionsIndex,
  validateSearch: zodValidator(bankTransactionRouteSearchSchema),
  // The schema folds the former Activity filter into Cash flow; drop its key so clearing Cash flow clears it.
  // The list loads more in place, so page keys from older links are dropped too.
  search: {
    middlewares: [stripSearchParams(['financialEventTypes', 'pageIndex', 'pageSize'] as never)],
  },
  beforeLoad: ({context}) => {
    handleAuthenticatedRedirect(context);
  },
});

function BankTransactionsIndex() {
  const searchParams = Route.useSearch();
  const navigate = useNavigate({from: '/bank-transactions/'});
  const transactionId = searchParams.transactionId;
  const {openTransaction, closeTransaction} = useBankTransactionInspector();
  const {pages, transactions, total, totals, totalsPlaceholder, isFiltered, filters, sort} =
    useBankTransactionLedger(searchParams);

  const clearFilters = () =>
    void navigate({
      search: (prev) => ({
        ...prev,
        ...Object.fromEntries(BANK_TRANSACTION_FILTER_KEYS.map((key) => [key, undefined])),
      }),
    });

  // Offline, a list never loaded reads as unavailable; a later page that fails keeps the rows (see LoadMore).
  const status = savedDataStatus(pages);
  const isPending = status.isPending;
  const isError = status.isError && pages.data === undefined;
  // Rows kept from the previous filters say nothing about whether the account has any.
  const isEmpty = !isPending && !isError && !pages.isPlaceholderData && total === 0 && !isFiltered;

  return (
    <>
      {/* The first load shows skeleton rows; a refetch after a filter change uses the page's bar, never one on a card. */}
      <LoadingBar isPending={pages.isPlaceholderData} />
      <AppBodyLayout>
        <div className='space-y-5 max-md:space-y-4'>
          <div className='flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1'>
            <h1 className='text-page-title'>Bank transactions</h1>
            {isPending ? (
              <p className='text-sm' aria-hidden='true'>
                <TextBone className='w-[10em]' />
              </p>
            ) : (
              !isError && (
                <LedgerSummary
                  count={total}
                  totals={totals}
                  settled={!pages.isPlaceholderData && !totalsPlaceholder}
                  missingLinked={filters.baseAmount !== 'MISSING'}
                />
              )
            )}
          </div>

          {isError ? (
            <LoadErrorState
              title="Couldn't load transactions"
              error={pages.error}
              onRetry={() => pages.refetch()}
            >
              {isFiltered && (
                <Button variant='ghost' onClick={clearFilters}>
                  Clear filters
                </Button>
              )}
            </LoadErrorState>
          ) : isEmpty ? (
            <NoTransactionsYet />
          ) : (
            <>
              <div className='grid gap-3'>
                <div className='flex items-center gap-2 md:gap-3'>
                  <LedgerSearch search={filters.search} />
                  <div className='contents max-md:hidden'>
                    <BankTransactionDateFilter filters={filters} />
                    <BankTransactionReviewToggle filters={filters} />
                  </div>
                  <div className='ml-auto flex items-center gap-2'>
                    <BankTransactionSortMenu sort={sort} />
                    <BankTransactionFilters
                      filters={filters}
                      isFilteringApplied={isFiltered}
                      onClearFilters={clearFilters}
                    />
                  </div>
                </div>
                <BankTransactionFilterChips filters={filters} />
              </div>

              <div
                className={cn(
                  'grid gap-2 transition-opacity duration-200',
                  // Rows for the previous filters stay put but fade, after a beat so quick answers don't flicker.
                  pages.isPlaceholderData && 'opacity-50 delay-150',
                )}
                aria-busy={pages.isPlaceholderData || undefined}
              >
                {isPending ? (
                  <LedgerSkeleton />
                ) : (
                  <>
                    <BankTransactionLedger
                      transactions={transactions}
                      groupByDay={sort.by === 'bookingDate'}
                      empty={
                        isFiltered ? (
                          <NoMatchingTransactions filters={filters} onClearFilters={clearFilters} />
                        ) : (
                          <NoTransactionsYet />
                        )
                      }
                      onTransactionSelect={openTransaction}
                    />
                    {/* Rows kept from the previous filters can't be continued. */}
                    {!pages.isPlaceholderData && <LoadMore query={pages} />}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </AppBodyLayout>
      <BankTransactionDetailsDialog
        transactionId={transactionId ?? ''}
        open={Boolean(transactionId)}
        onOpenChange={closeTransaction}
      />
    </>
  );
}

/** The search box. It holds what is typed, so a keystroke re-renders only the box, and applies it after a pause. */
function LedgerSearch({search}: {search: string | undefined}) {
  const navigate = useNavigate({from: '/bank-transactions/'});
  const [input, setInput] = useState(search || '');
  useEffect(() => setInput(search || ''), [search]);
  useEffect(() => {
    const next = input.trim() || undefined;
    if (next === search) return;
    const timeoutId = window.setTimeout(
      () => void navigate({search: (prev) => ({...prev, search: next})}),
      300,
    );
    return () => window.clearTimeout(timeoutId);
  }, [search, navigate, input]);

  return (
    <div className='relative min-w-0 flex-1 md:max-w-sm'>
      <Search className='absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
      <Input
        value={input}
        maxLength={BANK_TRANSACTION_SEARCH_MAX_LENGTH}
        onChange={(event) => setInput(event.target.value)}
        placeholder='Search...'
        aria-label='Search transactions'
        className='h-12 pl-9 sm:h-8'
        data-testid='bank-transactions-search'
      />
    </div>
  );
}

/**
 * How many rows match and, with a filter in force, what they spent and earned, and how many of them those totals
 * leave out for want of an amount in the reporting currency. It keeps the last settled line while the list and its
 * totals refetch, then swaps to the new one once both have arrived and fades it in: the line changes once, in place,
 * instead of jumping as each figure lands. Without a reporting currency to add them up in, it counts rows only.
 */
function LedgerSummary({
  count,
  totals,
  settled,
  missingLinked,
}: {
  count: number;
  totals:
    Pick<BankTransactionTotals, 'spending' | 'income' | 'baseCurrency' | 'excluded'> | undefined;
  settled: boolean;
  /** Whether the left-out rows can be listed; not while the list already shows only them. */
  missingLinked: boolean;
}) {
  const parts: SummaryPart[] = [
    {text: `${count.toLocaleString()} ${count === 1 ? 'transaction' : 'transactions'}`},
  ];
  const currency = totals?.baseCurrency ?? null;
  if (totals && currency && toCents(totals.spending) !== 0) {
    parts.push({
      figure: formatMoney(Math.abs(Number(totals.spending)), currency),
      word: 'spent',
    });
  }
  if (totals && currency && toCents(totals.income) !== 0) {
    parts.push({
      figure: formatMoney(totals.income, currency),
      word: 'earned',
      income: true,
    });
  }
  const missing =
    totals && currency && missingLinked
      ? {count: totals.excluded.missingBaseAmount, currency}
      : null;
  const keyOf = (line: Shown) =>
    [
      ...line.parts.map((part) => part.text ?? `${part.figure} ${part.word}`),
      line.missing?.count ?? 0,
    ].join(' · ');
  // Until the list and its totals have both arrived once, the line stays a bone.
  const [shown, setShown] = useState<Shown | null>(settled ? {parts, missing} : null);
  if (settled && (!shown || keyOf({parts, missing}) !== keyOf(shown))) setShown({parts, missing});

  if (!shown) {
    return (
      <p className='text-sm' aria-hidden='true'>
        <TextBone className='w-[10em]' />
      </p>
    );
  }

  // The wrapper stays; the line is replaced, so it fades in as a whole.
  return (
    <div className='grid justify-items-start gap-0.5 text-sm text-muted-foreground md:justify-items-end md:text-right'>
      <p
        key={keyOf(shown)}
        className='animate-in duration-200 fade-in motion-reduce:animate-none'
        data-testid='bank-transactions-summary'
        aria-live='polite'
      >
        {shown.parts.map((part, index) => (
          <Fragment key={index}>
            {index > 0 && ' · '}
            <span className='whitespace-nowrap'>
              {part.text ?? (
                <>
                  <span className={cn('numeric', part.income ? 'text-success' : 'text-foreground')}>
                    {part.figure}
                  </span>{' '}
                  {part.word}
                </>
              )}
            </span>
          </Fragment>
        ))}
      </p>
      {shown.missing && shown.missing.count > 0 && (
        <MissingAmountsLink
          key={`missing-${shown.missing.count}`}
          count={shown.missing.count}
          currency={shown.missing.currency}
        />
      )}
    </div>
  );
}

type Shown = {parts: SummaryPart[]; missing: {count: number; currency: string} | null};

/** The rows a total leaves out, listed under the same filters. */
function MissingAmountsLink({count, currency}: {count: number; currency: string}) {
  return (
    <Link
      to='/bank-transactions'
      search={(prev) => ({...prev, baseAmount: 'MISSING' as const})}
      className='inline-flex items-center gap-1.5 text-warning underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
      data-testid='missing-base-amounts-link'
    >
      <CircleAlert aria-hidden='true' className='size-3.5 shrink-0' />
      {missingAmountsLabel(count, currency)}
    </Link>
  );
}

type SummaryPart = {text?: string; figure?: string; word?: string; income?: boolean};

/** Placeholder days shaped like the list: a day label over a card of rows. */
function LedgerSkeleton() {
  return (
    <div className='grid gap-5' aria-busy='true'>
      <LoadingLabel>Loading transactions</LoadingLabel>
      {[3, 5].map((count, index) => (
        <div key={index} className='grid gap-1.5' aria-hidden='true'>
          <Bone className='mx-1 h-3 w-24 rounded-sm' />
          <ul className='divide-y divide-border/60 overflow-hidden rounded-card border bg-card'>
            <TileRowsSkeleton count={count} />
          </ul>
        </div>
      ))}
    </div>
  );
}
