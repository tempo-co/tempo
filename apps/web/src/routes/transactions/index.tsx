import {createFileRoute, stripSearchParams, useNavigate} from '@tanstack/react-router';
import {zodValidator} from '@tanstack/zod-adapter';
import {
  BANK_TRANSACTION_BULK_MAX_IDS,
  BANK_TRANSACTION_SEARCH_MAX_LENGTH,
  type BankTransactionBulkSelection,
  BankTransactionCategory,
} from '@tempo/contracts';
import {CircleCheck, Layers, ListChecks} from 'lucide-react';
import {useEffect, useState} from 'react';
import {toast} from 'sonner';

import {AppBodyLayout} from '@/components/shared/layout/app-body';
import {LoadMore} from '@/components/shared/load-more';
import {LoadingBar} from '@/components/shared/loading-bar';
import {SearchInput} from '@/components/shared/search-input';
import {LoadErrorState, StateMessage} from '@/components/shared/state-message';
import {Button} from '@/components/ui/button';
import {Sheet, SheetContent, SheetDescription, SheetTitle} from '@/components/ui/sheet';
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@/components/ui/tabs';
import {toBankTransactionFilter} from '@/features/banking/api/bank-transaction-filter-params';
import {useBankTransactionLedger} from '@/features/banking/api/use-bank-transaction-ledger';
import {usePreviewBulkCategory} from '@/features/banking/api/use-bulk-category';
import {useGetBankTransactionReviewCounts} from '@/features/banking/api/use-get-bank-transaction-review-counts';
import {useUpdateBulkLeftOutOfTotals} from '@/features/banking/api/use-left-out-of-totals';
import {
  BankTransactionBulkBar,
  BulkCategoryAction,
  BulkLeftOutAction,
} from '@/features/banking/components/bank-transaction-bulk-bar';
import {
  type BulkCategoryDraft,
  BulkCategoryStep,
} from '@/features/banking/components/bank-transaction-bulk-category-step';
import {BankTransactionDetailsPanel} from '@/features/banking/components/bank-transaction-details-panel';
import {
  NoMatchingTransactions,
  NoTransactionsYet,
} from '@/features/banking/components/bank-transaction-empty-states';
import {BankTransactionFilterChips} from '@/features/banking/components/bank-transaction-filter-chips';
import {BankTransactionLedger} from '@/features/banking/components/bank-transaction-ledger';
import {BankTransactionSortMenu} from '@/features/banking/components/bank-transaction-sort-menu';
import {
  SummaryStrip,
  ToCheckCard,
  ViewTotalsCard,
} from '@/features/banking/components/bank-transaction-view-totals';
import {ToCheckOneByOne} from '@/features/banking/components/to-check-one-by-one';
import {
  BANK_TRANSACTION_FILTER_KEYS,
  bankTransactionSearchParamsSchema,
} from '@/features/banking/types/bank-transaction';
import {Bone, LoadingLabel, TileRowsSkeleton} from '@/features/dashboard/components/loading';
import {useBankTransactionInspector} from '@/hooks/use-bank-transaction-inspector';
import {useHasRail} from '@/hooks/use-has-rail';
import {useRowSelection} from '@/hooks/use-row-selection';
import {wasToasted} from '@/utils/api';
import {cn} from '@/utils/cn';
import {handleAuthenticatedRedirect} from '@/utils/handle-redirect';
import {savedDataStatus} from '@/utils/query-status';

export const Route = createFileRoute('/transactions/')({
  component: TransactionsPage,
  validateSearch: zodValidator(bankTransactionSearchParamsSchema),
  // The list loads more in place, so page keys from older links are dropped.
  search: {
    middlewares: [stripSearchParams(['pageIndex', 'pageSize'] as never)],
  },
  beforeLoad: ({context}) => {
    handleAuthenticatedRedirect(context);
  },
});

/** What the chips' Clear removes: every filter except the tab and the search, which have their own controls. */
const CHIP_FILTER_KEYS = BANK_TRANSACTION_FILTER_KEYS.filter(
  (key) => key !== 'needsAttention' && key !== 'search',
);

function TransactionsPage() {
  const searchParams = Route.useSearch();
  const navigate = useNavigate({from: '/transactions/'});
  const hasRail = useHasRail();
  const transactionId = searchParams.transactionId;
  const {openTransaction, closeTransaction} = useBankTransactionInspector();
  const {
    pages,
    transactions,
    total,
    totals,
    totalsPlaceholder,
    dayTotals,
    isFiltered,
    filters,
    sort,
  } = useBankTransactionLedger(searchParams);
  const toCheck = useGetBankTransactionReviewCounts().reviewCounts?.needsAttention ?? 0;
  const tab = filters.needsAttention ? 'check' : 'all';

  // Picked rows hold while the list shows the same filters and order; another view starts over.
  const selection = useRowSelection(
    transactions.map(({id}) => id),
    JSON.stringify({filters, sort}),
  );
  const picked = selection.allMatching ? total : selection.selectedIds.length;
  const tooMany = !selection.allMatching && picked > BANK_TRANSACTION_BULK_MAX_IDS;
  // Phones show checkboxes only in Select mode; desktop always does.
  const [selectMode, setSelectMode] = useState(false);
  const showCheckboxes = hasRail || selectMode;
  const [bulkDraft, setBulkDraft] = useState<BulkCategoryDraft | null>(null);
  const {previewBulkCategory, isPending: isCheckingBulk} = usePreviewBulkCategory();
  const endSelection = () => {
    selection.clear();
    setSelectMode(false);
    setBulkDraft(null);
  };
  // Every matching row goes as the list's filters, which the server matches again when it writes.
  const bulkSelection = (): BankTransactionBulkSelection =>
    selection.allMatching
      ? {filter: toBankTransactionFilter(filters)}
      : {transactionIds: selection.selectedIds};
  const pickBulkCategory = (category: BankTransactionCategory) => {
    const picks = bulkSelection();
    previewBulkCategory(
      {...picks, category},
      {
        onSuccess: (preview) => setBulkDraft({selection: picks, category, preview}),
        onError: (error) => {
          if (!wasToasted(error)) {
            toast.error('Other transactions could not be checked. Nothing was saved. Try again.');
          }
        },
      },
    );
  };
  const {updateBulkLeftOutOfTotals, isPending: isSavingLeftOut} = useUpdateBulkLeftOutOfTotals();
  // Every picked row is left out already: the list shows only those, or each picked one is marked.
  const leftOutIds = new Set(transactions.filter((row) => row.leftOutOfTotals).map(({id}) => id));
  const allLeftOut = selection.allMatching
    ? filters.cashFlows?.length === 1 && filters.cashFlows[0] === 'LEFT_OUT'
    : picked > 0 && selection.selectedIds.every((id) => leftOutIds.has(id));
  const applyLeftOut = async (leftOutOfTotals: boolean) => {
    try {
      await updateBulkLeftOutOfTotals({...bulkSelection(), leftOutOfTotals});
      // Rows past the loaded ones change too, so the outcome is said once.
      toast.success(
        leftOutOfTotals ? `${picked} left out of totals` : `${picked} counted in totals again`,
      );
      endSelection();
    } catch (error) {
      if (!wasToasted(error)) toast.error("Couldn't change what counts in totals. Try again.");
    }
  };
  // The step stands for the rows it was asked for: picking or dropping a row, or another view, ends it.
  const isDraftSelection = ({selection: {transactionIds}}: BulkCategoryDraft) =>
    transactionIds
      ? !selection.allMatching &&
        transactionIds.length === picked &&
        transactionIds.every((id) => selection.isSelected(id))
      : selection.allMatching;
  const activeDraft = bulkDraft && isDraftSelection(bulkDraft) ? bulkDraft : null;
  if (bulkDraft && !activeDraft) setBulkDraft(null);
  const bulkStep = activeDraft && (
    <BulkCategoryStep
      draft={activeDraft}
      onDone={endSelection}
      onCancel={() => setBulkDraft(null)}
    />
  );

  const clearAll = () =>
    void navigate({
      search: (prev) => ({
        ...prev,
        ...Object.fromEntries(BANK_TRANSACTION_FILTER_KEYS.map((key) => [key, undefined])),
      }),
    });
  const clearChips = () =>
    void navigate({
      search: (prev) => ({
        ...prev,
        ...Object.fromEntries(CHIP_FILTER_KEYS.map((key) => [key, undefined])),
      }),
    });
  const showTab = (next: string) =>
    void navigate({
      search: (prev) => ({...prev, needsAttention: next === 'check' ? true : undefined}),
    });

  // Offline, a list never loaded reads as unavailable; a later page that fails keeps the rows (see LoadMore).
  const status = savedDataStatus(pages);
  const isPending = status.isPending;
  const isError = status.isError && pages.data === undefined;
  // Rows kept from the previous filters say nothing about whether the account has any.
  const isEmpty = !isPending && !isError && !pages.isPlaceholderData && total === 0 && !isFiltered;
  const totalsProps = {
    totals,
    settled: !pages.isPlaceholderData && !totalsPlaceholder,
    missingLinked: filters.baseAmount !== 'MISSING',
  };
  // Only the tab narrows the list: nothing left to check is done, not a filter that matches nothing.
  const onlyTab = tab === 'check' && countOtherFilters(filters) === 0;

  const list = isPending ? (
    <LedgerSkeleton />
  ) : (
    <>
      <BankTransactionLedger
        transactions={transactions}
        groupByDay={sort.by === 'date'}
        selectedId={transactionId}
        dayTotals={dayTotals}
        selection={
          showCheckboxes
            ? {rows: selection, picking: selectMode || picked > 0, matching: total}
            : undefined
        }
        empty={
          onlyTab ? (
            <StateMessage
              icon={CircleCheck}
              title='All checked'
              description='Every transaction has a category.'
            />
          ) : isFiltered ? (
            <NoMatchingTransactions filters={filters} onClearFilters={clearAll} />
          ) : (
            <NoTransactionsYet />
          )
        }
        onTransactionSelect={openTransaction}
      />
      {/* Rows kept from the previous filters can't be continued. */}
      {!pages.isPlaceholderData && <LoadMore query={pages} />}
      {picked > 0 && (
        <BankTransactionBulkBar count={picked} tooMany={tooMany} onClear={endSelection}>
          <BulkCategoryAction
            count={picked}
            tooMany={tooMany}
            sheet={!hasRail}
            isChecking={isCheckingBulk}
            onPick={pickBulkCategory}
          />
          <BulkLeftOutAction
            tooMany={tooMany}
            allLeftOut={allLeftOut}
            isSaving={isSavingLeftOut}
            onApply={(leftOutOfTotals) => void applyLeftOut(leftOutOfTotals)}
          />
        </BankTransactionBulkBar>
      )}
    </>
  );

  return (
    <>
      {/* The first load shows skeleton rows; a refetch after a filter change uses the page's bar, never one on a card. */}
      <LoadingBar isPending={pages.isPlaceholderData} />
      <AppBodyLayout>
        <div className='grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start'>
          <div className='min-w-0 space-y-5 max-md:space-y-4'>
            <div className='flex flex-wrap items-center justify-between gap-x-6 gap-y-3'>
              <h1 className='text-page-title'>Transactions</h1>
              {!isError && !isEmpty && (
                <div className='flex min-w-0 items-center gap-2 max-md:w-full'>
                  <LedgerSearch search={filters.search} />
                  <BankTransactionSortMenu sort={sort} />
                  {!hasRail && (
                    <Button
                      variant='outline'
                      aria-pressed={selectMode}
                      onClick={() => (selectMode ? endSelection() : setSelectMode(true))}
                      className='shrink-0 max-sm:h-12'
                    >
                      <ListChecks aria-hidden='true' />
                      {selectMode ? 'Done' : 'Select'}
                    </Button>
                  )}
                </div>
              )}
            </div>

            {isError ? (
              <LoadErrorState
                title="Couldn't load transactions"
                error={pages.error}
                onRetry={() => pages.refetch()}
              >
                {isFiltered && (
                  <Button variant='ghost' onClick={clearAll}>
                    Clear filters
                  </Button>
                )}
              </LoadErrorState>
            ) : isEmpty ? (
              <NoTransactionsYet />
            ) : (
              <Tabs value={tab} onValueChange={showTab}>
                <div className='flex flex-wrap items-center justify-between gap-2'>
                  <TabsList aria-label='Transactions to show'>
                    <TabsTrigger value='all'>All</TabsTrigger>
                    <TabsTrigger value='check'>
                      To check
                      {toCheck > 0 && (
                        <span className='grid h-4.5 min-w-4.5 place-items-center rounded-full bg-primary px-1 numeric text-caption font-semibold text-primary-foreground'>
                          {toCheck > 99 ? '99+' : toCheck}
                        </span>
                      )}
                    </TabsTrigger>
                  </TabsList>
                  {tab === 'check' && !hasRail && toCheck > 0 && (
                    <Button
                      size='sm'
                      onClick={() => void navigate({search: (prev) => ({...prev, oneByOne: true})})}
                    >
                      <Layers aria-hidden='true' />
                      One by one
                    </Button>
                  )}
                </div>
                <div className='mt-3 grid gap-3'>
                  <BankTransactionFilterChips filters={filters} onClear={clearChips} />
                  {!hasRail && <SummaryStrip {...totalsProps} />}
                </div>
                <TabsContent value={tab} className='mt-4' tabIndex={-1}>
                  <div
                    className={cn(
                      'grid gap-2 transition-opacity duration-200',
                      // Rows for the previous filters stay put but fade, after a beat so quick answers don't flicker.
                      pages.isPlaceholderData && 'opacity-50 delay-150',
                    )}
                    aria-busy={pages.isPlaceholderData || undefined}
                  >
                    {list}
                  </div>
                </TabsContent>
              </Tabs>
            )}
          </div>

          {/* A link to one row opens it whatever the list holds; an empty list has no totals to show. */}
          {hasRail && (transactionId || !isEmpty) && (
            <aside
              aria-label={
                bulkStep ? 'Change category' : transactionId ? 'Transaction details' : 'Totals'
              }
              className='sticky top-8 flex max-h-[calc(100dvh-(--spacing(16)))] min-h-0 flex-col gap-3'
            >
              {bulkStep ? (
                <div className='flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card'>
                  {bulkStep}
                </div>
              ) : transactionId ? (
                <DetailsRail
                  transactionId={transactionId}
                  onClose={() => closeTransaction(false)}
                />
              ) : (
                !isError && (
                  <>
                    <ViewTotalsCard {...totalsProps} />
                    {tab === 'all' && toCheck > 0 && (
                      <ToCheckCard count={toCheck} onCheck={() => showTab('check')} />
                    )}
                  </>
                )
              )}
            </aside>
          )}
        </div>
      </AppBodyLayout>
      {!hasRail && (
        <Sheet open={Boolean(transactionId)} onOpenChange={closeTransaction}>
          <SheetContent
            side='bottom'
            data-testid='bank-transaction-inspector'
            className='flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 pb-[env(safe-area-inset-bottom)] [&>button:last-child]:hidden'
          >
            <SheetDescription className='sr-only'>
              Payment summary and editable transaction details
            </SheetDescription>
            {transactionId && (
              <BankTransactionDetailsPanel
                transactionId={transactionId}
                onClose={() => closeTransaction(false)}
                renderTitle={(title) => <SheetTitle asChild>{title}</SheetTitle>}
              />
            )}
          </SheetContent>
        </Sheet>
      )}
      {!hasRail && (
        <Sheet open={Boolean(bulkStep)} onOpenChange={(open) => !open && setBulkDraft(null)}>
          <SheetContent
            side='bottom'
            className='flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 pb-[env(safe-area-inset-bottom)] [&>button:last-child]:hidden'
          >
            <SheetTitle className='sr-only'>Change category</SheetTitle>
            <SheetDescription className='sr-only'>
              Change only the selected transactions or all from their payees
            </SheetDescription>
            {bulkStep}
          </SheetContent>
        </Sheet>
      )}
      {searchParams.oneByOne && !hasRail && (
        <ToCheckOneByOne
          onClose={() => void navigate({search: (prev) => ({...prev, oneByOne: undefined})})}
        />
      )}
    </>
  );
}

/** Filters in force besides the tab and the search. */
function countOtherFilters(filters: ReturnType<typeof useBankTransactionLedger>['filters']) {
  return (
    CHIP_FILTER_KEYS.filter((key) => {
      const value = filters[key];
      return Array.isArray(value) ? value.length > 0 : Boolean(value);
    }).length + (filters.search?.trim() ? 1 : 0)
  );
}

/**
 * The open row's details beside the list. They never cover it; Escape closes them unless something inside handled
 * it first (an open menu, or the "update other transactions" step).
 */
function DetailsRail({transactionId, onClose}: {transactionId: string; onClose: () => void}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);
  return (
    <div
      data-testid='bank-transaction-inspector'
      className='flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card'
    >
      <BankTransactionDetailsPanel transactionId={transactionId} onClose={onClose} focusOnOpen />
    </div>
  );
}

/** The search box. It holds what is typed, so a keystroke re-renders only the box, and applies it after a pause. */
function LedgerSearch({search}: {search: string | undefined}) {
  const navigate = useNavigate({from: '/transactions/'});
  const [input, setInput] = useState(search || '');
  // A search changed elsewhere (applied, cleared, back navigation) replaces what is typed.
  const [shownSearch, setShownSearch] = useState(search);
  if (search !== shownSearch) {
    setShownSearch(search);
    setInput(search || '');
  }
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
    <SearchInput
      value={input}
      onValueChange={setInput}
      // Clearing applies at once instead of after the typing pause.
      onClear={() => void navigate({search: (prev) => ({...prev, search: undefined})})}
      maxLength={BANK_TRANSACTION_SEARCH_MAX_LENGTH}
      placeholder='Search...'
      aria-label='Search transactions'
      wrapperClassName='flex-1 md:w-64'
      className='h-12 sm:h-8'
      data-testid='bank-transactions-search'
    />
  );
}

/** Placeholder days shaped like the list: a day label over a card of rows. */
function LedgerSkeleton() {
  return (
    <div className='grid gap-5' aria-busy='true'>
      <LoadingLabel>Loading transactions</LoadingLabel>
      {[3, 5].map((count, index) => (
        <div key={index} className='grid gap-1.5' aria-hidden='true'>
          <Bone className='mx-1 h-3 w-24 rounded-sm' />
          <ul className='divide-y divide-border/60 overflow-hidden rounded-lg border bg-card'>
            <TileRowsSkeleton count={count} />
          </ul>
        </div>
      ))}
    </div>
  );
}
