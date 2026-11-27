import {useInfiniteQuery} from '@tanstack/react-query';
import type {
  BankTransaction,
  BankTransactionCategory,
  BankTransactionCategoryImpact,
  BankTransactionsResponse,
} from '@wisp/contracts';
import {ChevronRight, CircleCheck, X} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';
import {toast} from 'sonner';

import {CurrencyAmount} from '@/components/shared/currency-amount';
import {PendingLabel} from '@/components/shared/pending-label';
import {LoadErrorState} from '@/components/shared/state-message';
import {Button} from '@/components/ui/button';
import {Sheet, SheetContent, SheetDescription, SheetTitle} from '@/components/ui/sheet';
import {Skeleton} from '@/components/ui/skeleton';
import {api, wasToasted} from '@/utils/api';
import {cn} from '@/utils/cn';

import {usePreviewBankTransactionCategory} from '../api/use-preview-bank-transaction-category';
import {useUpdateBankTransactionCategory} from '../api/use-update-bank-transaction-category';
import {
  BANK_TRANSACTION_CATEGORY_META,
  PICKABLE_CATEGORIES,
} from '../utils/bank-transaction-category-meta';
import {
  formatBankTransactionCompactDate,
  resolveBankTransactionAccountLabel,
  resolveBankTransactionDisplayTitle,
} from '../utils/formatters';
import {BankTransactionCategoryIcon} from './bank-transaction-category-icon';
import {MerchantLogoTile} from './merchant-logo-tile';

/** Rows loaded at a time; the next ones load when the walk reaches the end of these. */
const QUEUE_SIZE = 100;

/** The rows still to check that the walk has not reached, and how many rows To check held when they loaded. */
type Batch = {rows: BankTransaction[]; remaining: number; sortedBefore: number};

type Walked = {sorted: string[]; skipped: string[]};

/**
 * The next rows to check that the walk has not reached. Sorted rows leave To check and skipped ones stay, newest
 * first, so they start after the skipped ones; a page holding only rows already reached moves on to the next.
 */
async function loadBatch({sorted, skipped}: Walked): Promise<Batch> {
  const reached = new Set([...sorted, ...skipped]);
  for (let pageIndex = Math.floor(skipped.length / QUEUE_SIZE); ; pageIndex++) {
    const page = await api.get<BankTransactionsResponse>(
      `/bank-transactions?${new URLSearchParams({
        'filter[needsAttention]': 'true',
        'pagination[pageIndex]': String(pageIndex),
        'pagination[pageSize]': String(QUEUE_SIZE),
      })}`,
    );
    const rows = page.transactions.filter(({id}) => !reached.has(id));
    if (rows.length > 0 || (pageIndex + 1) * QUEUE_SIZE >= page.total)
      return {rows, remaining: page.total, sortedBefore: sorted.length};
  }
}

/** The six categories offered first, by the way the money went; All categories lists the rest. */
const LIKELY_CATEGORIES: Record<'out' | 'in', BankTransactionCategory[]> = {
  out: [
    'GROCERIES',
    'EATING_OUT',
    'SHOPPING',
    'TRANSPORTATION',
    'HOUSING_AND_UTILITIES',
    'SERVICES',
  ],
  in: [
    'INCOME',
    'REFUND',
    'TRANSFER_IN',
    'GIFTS_AND_DONATIONS',
    'TAXES_AND_GOVERNMENT',
    'LOANS_AND_DEBT',
  ],
};

type Asked = {category: BankTransactionCategory; impact: BankTransactionCategoryImpact};

/**
 * Checking the To check rows one at a time on a phone: "1 of 12", six likely categories then All categories, the
 * choice to update the payee's other transactions, Skip, and a done state. It goes on until no row waits that it has
 * not reached; a skipped row stays in To check.
 */
export function ToCheckOneByOne({onClose}: {onClose: () => void}) {
  const [sorted, setSorted] = useState<string[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  // Read when the next rows load, once the walk has reached every row loaded before them.
  const walkedRef = useRef<Walked>({sorted, skipped});
  // The rows reached so far shape only the next batch, not which query this is.
  // eslint-disable-next-line @tanstack/query/exhaustive-deps
  const queue = useInfiniteQuery({
    // Outside the transaction lists' keys, so a saved category doesn't reshuffle the rows mid-walk.
    queryKey: ['to-check-one-by-one'],
    queryFn: () => loadBatch(walkedRef.current),
    initialPageParam: 0,
    // A batch with no rows means none is left that the walk has not reached.
    getNextPageParam: (last, batches) => (last.rows.length > 0 ? batches.length : undefined),
    staleTime: Infinity,
    gcTime: 0,
  });
  const batches = queue.data?.pages ?? [];
  const rows = batches.flatMap((batch) => batch.rows);
  const latest = batches[batches.length - 1] as Batch | undefined;
  const total = latest ? latest.sortedBefore + latest.remaining : 0;
  const done = sorted.length + skipped.length;
  const current = rows.find(({id}) => !sorted.includes(id) && !skipped.includes(id));
  const {hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage} = queue;
  useEffect(() => {
    walkedRef.current = {sorted, skipped};
    // A failed load waits for Try again.
    if (!current && hasNextPage && !isFetchingNextPage && !isFetchNextPageError)
      void fetchNextPage();
  }, [
    sorted,
    skipped,
    current,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
  ]);

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side='bottom'
        data-testid='to-check-one-by-one'
        className='inset-y-0 flex h-dvh max-h-dvh flex-col gap-0 rounded-none border-0 p-0 pb-[env(safe-area-inset-bottom)] [&>button:last-child]:hidden'
      >
        <header className='grid shrink-0 grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center border-b px-2 py-1'>
          <Button
            variant='ghost'
            size='icon'
            className='size-11'
            aria-label='Close one by one'
            onClick={onClose}
          >
            <X aria-hidden='true' />
          </Button>
          <SheetTitle
            className='text-center text-body font-medium'
            data-testid='one-by-one-progress'
          >
            {current ? `${done + 1} of ${total}` : 'To check'}
          </SheetTitle>
        </header>
        <SheetDescription className='sr-only'>
          Pick a category for each transaction to check, or skip it.
        </SheetDescription>
        {total > 0 && (
          <div className='h-1 shrink-0 bg-muted' aria-hidden='true'>
            <div
              className='h-full bg-primary transition-[width] duration-200 motion-reduce:transition-none'
              style={{width: `${Math.min(done / total, 1) * 100}%`}}
            />
          </div>
        )}
        <div className='min-h-0 flex-1 overflow-y-auto overscroll-contain p-4'>
          {queue.isPending ? (
            <Skeleton className='h-96 w-full' />
          ) : queue.isError && !current ? (
            <LoadErrorState
              size='section'
              title="Couldn't load transactions to check"
              error={queue.error}
              onRetry={() => void (isFetchNextPageError ? fetchNextPage() : queue.refetch())}
            />
          ) : current ? (
            <CheckCard
              key={current.id}
              transaction={current}
              onSorted={(ids) => {
                // Rows "update others" settled with it leave the walk too, skipped ones included.
                setSorted((done) => [
                  ...done,
                  ...rows
                    .filter(({id}) => ids.includes(id) && !done.includes(id))
                    .map(({id}) => id),
                ]);
                setSkipped((passed) => passed.filter((id) => !ids.includes(id)));
              }}
              onSkip={() => setSkipped((ids) => [...ids, current.id])}
            />
          ) : hasNextPage ? (
            <Skeleton className='h-96 w-full' />
          ) : (
            <section
              aria-label='All checked'
              className='grid justify-items-center gap-3 pt-12 text-center'
            >
              <CircleCheck aria-hidden='true' className='size-10 text-success' />
              <h2 className='text-section-title'>All checked</h2>
              <p className='text-body text-muted-foreground'>
                {sorted.length.toLocaleString()} sorted
                {skipped.length > 0 &&
                  ` · ${skipped.length.toLocaleString()} skipped, still in To check`}
              </p>
              <Button className='mt-3' onClick={onClose}>
                Back to Transactions
              </Button>
            </section>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function CheckCard({
  transaction,
  onSorted,
  onSkip,
}: {
  transaction: BankTransaction;
  /** Called with the ids the save settled: this row and any others it updated. */
  onSorted: (ids: string[]) => void;
  onSkip: () => void;
}) {
  const {previewBankTransactionCategory, isPending: isChecking} =
    usePreviewBankTransactionCategory();
  const {updateBankTransactionCategory, isPending: isSaving} = useUpdateBankTransactionCategory();
  const [picked, setPicked] = useState<BankTransactionCategory | null>(null);
  const [asked, setAsked] = useState<Asked | null>(null);
  const [allOpen, setAllOpen] = useState(false);
  const title = resolveBankTransactionDisplayTitle(transaction);
  const likely = LIKELY_CATEGORIES[transaction.direction === 'INCOME' ? 'in' : 'out'];
  const busy = isChecking || isSaving;

  const save = async (category: BankTransactionCategory, applyToTransactionIds: string[]) => {
    try {
      await updateBankTransactionCategory({id: transaction.id, category, applyToTransactionIds});
      onSorted([transaction.id, ...applyToTransactionIds]);
    } catch {
      // The mutation toast reports the error; the row stays so the owner can try again.
    }
  };

  const pick = (category: BankTransactionCategory) => {
    setPicked(category);
    setAsked(null);
    setAllOpen(false);
    previewBankTransactionCategory(
      {id: transaction.id, category},
      {
        onSuccess: (impact) => {
          if (impact.transactions.length > 0) setAsked({category, impact});
          else void save(category, []);
        },
        onError: (error) => {
          setPicked(null);
          if (!wasToasted(error)) {
            toast.error('Category changes could not be previewed. Nothing was saved. Try again.');
          }
        },
      },
    );
  };

  const option = (category: BankTransactionCategory, className?: string) => (
    <button
      key={category}
      type='button'
      disabled={busy || asked !== null}
      aria-pressed={picked === category}
      onClick={() => pick(category)}
      className={cn(
        'flex min-h-11 min-w-0 items-center gap-2 rounded-md border bg-background px-3 text-left text-body focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60 aria-pressed:border-primary aria-pressed:bg-accent aria-pressed:opacity-100',
        className,
      )}
    >
      <BankTransactionCategoryIcon category={category} className='size-6' />
      <span className='min-w-0 truncate'>{BANK_TRANSACTION_CATEGORY_META[category].label}</span>
    </button>
  );

  const others = asked?.impact.transactions.length ?? 0;
  const pickedLabel = picked ? BANK_TRANSACTION_CATEGORY_META[picked].label : '';
  const word = transaction.direction === 'INCOME' ? 'transaction' : 'payment';
  const noun = `${word}${others === 1 ? '' : 's'}`;
  const sameName = asked?.impact.transactions.every(
    (row) => row.displayDescription === transaction.displayDescription,
  );

  return (
    <div className='grid gap-4'>
      <section
        aria-labelledby='one-by-one-title'
        className='grid gap-4 rounded-lg border bg-card p-4'
        data-testid='one-by-one-card'
      >
        <div className='grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3'>
          <MerchantLogoTile transaction={transaction} />
          <div className='min-w-0'>
            <h2 id='one-by-one-title' className='truncate text-body font-medium'>
              {title}
            </h2>
            <p className='truncate text-body-small text-muted-foreground'>
              {formatBankTransactionCompactDate(transaction.date)} ·{' '}
              {resolveBankTransactionAccountLabel(transaction)}
            </p>
          </div>
          <span className='text-body'>
            <CurrencyAmount amount={Number(transaction.amount)} currency={transaction.currency} />
          </span>
        </div>
        {transaction.description && (
          <p className='rounded-md bg-muted px-3 py-2 font-mono text-label wrap-anywhere text-muted-foreground'>
            {transaction.description}
          </p>
        )}
        <div className='grid gap-2'>
          <p className='text-label text-muted-foreground'>Pick a category</p>
          <div className='grid grid-cols-2 gap-2'>
            {likely.map((category) => option(category))}
            {picked && !likely.includes(picked) && option(picked, 'col-span-2')}
          </div>
          <Button
            variant='ghost'
            className='justify-between'
            aria-expanded={allOpen}
            disabled={busy || asked !== null}
            onClick={() => setAllOpen((open) => !open)}
          >
            All categories
            <ChevronRight
              aria-hidden='true'
              className={cn(
                'transition-transform motion-reduce:transition-none',
                allOpen && 'rotate-90',
              )}
            />
          </Button>
          {allOpen && (
            <div role='group' aria-label='All categories' className='grid gap-2'>
              {PICKABLE_CATEGORIES.filter((category) => !likely.includes(category)).map(
                (category) => option(category),
              )}
            </div>
          )}
        </div>
        {(isChecking || (isSaving && !asked)) && (
          <p role='status' className='text-body-small text-muted-foreground'>
            <PendingLabel>{isChecking ? 'Checking other transactions…' : 'Saving…'}</PendingLabel>
          </p>
        )}
        {asked && picked && (
          <div
            role='group'
            aria-labelledby='one-by-one-others'
            className='grid gap-3 rounded-md border bg-background p-3'
          >
            <p id='one-by-one-others' className='text-body font-medium'>
              {asked.impact.action === 'RECHECK'
                ? `Let AI re-check ${others} other ${sameName ? `${title} ` : ''}${noun}?`
                : `Also put ${others} other ${sameName ? `${title} ` : ''}${noun} in ${pickedLabel}?`}
            </p>
            {/* The preview lists the newest matches only; the rail's step says the same. */}
            {asked.impact.total > others && (
              <p className='text-body-small text-muted-foreground'>
                The {(asked.impact.total - others).toLocaleString()} older ones stay as they are.
              </p>
            )}
            <div className='grid grid-cols-2 gap-2'>
              <Button
                variant='outline'
                disabled={isSaving}
                onClick={() => void save(asked.category, [])}
              >
                Just this one
              </Button>
              <Button
                disabled={isSaving}
                onClick={() =>
                  void save(
                    asked.category,
                    asked.impact.transactions.map(({id}) => id),
                  )
                }
              >
                {isSaving ? (
                  <PendingLabel>Saving…</PendingLabel>
                ) : asked.impact.action === 'RECHECK' ? (
                  `Re-check ${others}`
                ) : (
                  `All ${others + 1}`
                )}
              </Button>
            </div>
          </div>
        )}
      </section>
      <Button variant='ghost' disabled={busy} onClick={onSkip}>
        Skip for now
      </Button>
    </div>
  );
}
