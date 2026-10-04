import {useNavigate} from '@tanstack/react-router';
import {SortingState, flexRender, getCoreRowModel, useReactTable} from '@tanstack/react-table';
import {RefreshCw, Search, SearchX} from 'lucide-react';
import {useEffect, useState} from 'react';

import {EmptyState} from '@/components/shared/layout/app-empty-state';
import {LoadingBar} from '@/components/shared/loading-bar';
import {Pagination} from '@/components/shared/pagination';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Skeleton} from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {PaginationParams} from '@/types/pagination';
import {cn} from '@/utils/cn';

import {
  BankTransaction,
  BankTransactionFilterParams,
  BankTransactionSortField,
  BankTransactionSortOrder,
  BankTransactionSortParams,
  DEFAULT_BANK_TRANSACTION_SORT,
} from '../types/bank-transaction';
import {
  formatBankTransactionActivity,
  formatBankTransactionCategory,
  formatBankTransactionCompactDate,
  isBankTransactionCategory,
  resolveBankTransactionDisplayTitle,
} from '../utils/formatters';
import {BankTransactionAccountFilter} from './bank-transaction-account-filter';
import {BankTransactionCategoryFilter} from './bank-transaction-category-filter';
import {BankTransactionCategoryIcon} from './bank-transaction-category-icon';
import {BankTransactionCategorySourceFilter} from './bank-transaction-category-source-filter';
import {BankTransactionDateFilter} from './bank-transaction-date-filter';
import {BankTransactionFinancialEventFilter} from './bank-transaction-financial-event-filter';
import {BankTransactionMobileFilters} from './bank-transaction-mobile-filters';
import {bankTransactionTableColumns} from './bank-transaction-table-columns';

type BankTransactionTableProps = {
  transactions: BankTransaction[];
  totalTransactions: number;
  isPending: boolean;
  isPlaceholderData: boolean;
  pagination: PaginationParams;
  filters: BankTransactionFilterParams;
  sort: BankTransactionSortParams;
  isError: boolean;
  onRetry: () => void;
  onTransactionSelect: (transactionId: BankTransaction['id'], trigger: HTMLButtonElement) => void;
};

export function BankTransactionTable({
  transactions,
  totalTransactions,
  isPending,
  isPlaceholderData,
  pagination,
  filters,
  sort,
  isError,
  onRetry,
  onTransactionSelect,
}: BankTransactionTableProps) {
  const navigate = useNavigate({from: '/bank-transactions/'});
  const [searchInput, setSearchInput] = useState(filters.search || '');
  const isFilteringApplied =
    !!filters.bookingDate ||
    (filters.bankAccountIds?.length ?? 0) > 0 ||
    (filters.categories?.length ?? 0) > 0 ||
    (filters.categorySources?.length ?? 0) > 0 ||
    (filters.financialEventTypes?.length ?? 0) > 0 ||
    !!filters.search?.trim();

  useEffect(() => {
    setSearchInput(filters.search || '');
  }, [filters.search]);

  useEffect(() => {
    const search = searchInput.trim() || undefined;
    if (search === filters.search) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void navigate({search: (prev) => ({...prev, search, pageIndex: 0})});
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [filters.search, navigate, searchInput]);

  const sorting: SortingState = sort
    ? [{id: sort.by, desc: sort.order === BankTransactionSortOrder.DESC}]
    : [];

  const handleSortingChange = (
    updaterOrValue: SortingState | ((prev: SortingState) => SortingState),
  ) => {
    const updatedSorting =
      typeof updaterOrValue === 'function' ? updaterOrValue(sorting) : updaterOrValue;
    const firstSort = updatedSorting[0];
    const nextSort =
      firstSort && isBankTransactionSortField(firstSort.id)
        ? {
            by: firstSort.id,
            order: firstSort.desc ? BankTransactionSortOrder.DESC : BankTransactionSortOrder.ASC,
          }
        : DEFAULT_BANK_TRANSACTION_SORT;

    void navigate({search: (prev) => ({...prev, sort: nextSort, pageIndex: 0})});
  };

  const table = useReactTable({
    data: transactions,
    columns: bankTransactionTableColumns,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualFiltering: true,
    manualPagination: true,
    state: {
      pagination,
      sorting,
    },
    rowCount: totalTransactions,
    onSortingChange: handleSortingChange,
  });

  const clearFilters = () => {
    void navigate({
      search: (prev) => ({
        ...prev,
        bookingDate: undefined,
        bankAccountIds: undefined,
        categories: undefined,
        categorySources: undefined,
        financialEventTypes: undefined,
        search: undefined,
        pageIndex: 0,
      }),
    });
  };

  if (isPending) {
    return <Skeleton className='h-88 w-full rounded-lg bg-card' />;
  }

  if (isError) {
    return (
      <EmptyState
        icon={RefreshCw}
        title='Could not load bank transactions'
        description='The transaction service did not respond. Try again in a moment.'
      >
        <Button variant='outline' onClick={onRetry}>
          Try again
        </Button>
      </EmptyState>
    );
  }

  const isEmptyState = totalTransactions === 0 && !isPlaceholderData && !isFilteringApplied;
  if (isEmptyState) {
    return (
      <EmptyState
        icon={Search}
        title='No bank transactions found'
        description='Synchronize a bank connection to make its transactions appear here.'
      />
    );
  }

  return (
    <>
      <div className='flex flex-wrap items-center gap-3 max-md:gap-2'>
        <div className='relative min-w-0 flex-1 md:max-w-sm md:min-w-56'>
          <Search className='absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder='Search...'
            aria-label='Search transactions'
            className='h-12 pl-9 sm:h-8'
            data-testid='bank-transactions-search'
          />
        </div>
        <BankTransactionMobileFilters
          filters={filters}
          isFilteringApplied={isFilteringApplied}
          onClearFilters={clearFilters}
          className='md:hidden'
        />
        <div
          className='hidden w-full flex-col gap-2 md:contents'
          data-testid='bank-transaction-desktop-filters'
        >
          <BankTransactionDateFilter filters={filters} className='max-md:w-full max-md:min-w-0' />
          <BankTransactionCategoryFilter
            filters={filters}
            className='max-md:w-full max-md:min-w-0'
          />
          <BankTransactionCategorySourceFilter
            filters={filters}
            className='max-md:w-full max-md:min-w-0'
          />
          <BankTransactionFinancialEventFilter
            filters={filters}
            className='max-md:w-full max-md:min-w-0'
          />
          <BankTransactionAccountFilter
            filters={filters}
            className='max-md:w-full max-md:min-w-0'
          />
        </div>
        {isFilteringApplied && (
          <Button
            variant='secondary'
            size='sm'
            className='hidden h-8 md:inline-flex'
            onClick={clearFilters}
          >
            Clear filters
          </Button>
        )}
      </div>
      <div className='relative'>
        <LoadingBar isPending={isPlaceholderData} />
        <Table
          data-testid='bank-transactions-table'
          aria-label='Bank transactions'
          wrapperClassName='max-lg:rounded-none max-lg:border-0'
          className='table-fixed max-lg:block max-lg:w-full'
        >
          <colgroup>
            <col className='w-32' />
            <col />
            <col className='w-[22%]' />
            <col className='w-[18%]' />
            <col className='w-48' />
          </colgroup>
          <TableCaption className='sr-only'>
            Bank transaction records. Select a transaction description to view its full details.
          </TableCaption>
          <TableHeader className='max-lg:sr-only'>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const sortDirection = header.column.getIsSorted();

                  return (
                    <TableHead
                      key={header.id}
                      className='p-0'
                      aria-sort={
                        sortDirection === 'asc'
                          ? 'ascending'
                          : sortDirection === 'desc'
                            ? 'descending'
                            : undefined
                      }
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody className='max-lg:block'>
            {totalTransactions === 0 && isFilteringApplied ? (
              <TableRow className='max-lg:block'>
                <TableCell
                  colSpan={bankTransactionTableColumns.length}
                  className='h-24 text-center max-lg:block'
                >
                  <div className='my-4 flex flex-col items-center gap-4'>
                    <SearchX className='h-12 w-12 text-muted-foreground' />
                    <div>
                      <p className='mb-2 text-base'>No bank transactions found</p>
                      <p className='text-muted-foreground'>
                        The applied filters did not match any transactions.
                      </p>
                    </div>
                    <Button variant='outline' onClick={clearFilters}>
                      Clear filters
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => {
                const transactionLabel = resolveBankTransactionDisplayTitle(row.original);
                const financialEvent = formatBankTransactionActivity(row.original);
                const category =
                  !row.original.category || !isBankTransactionCategory(row.original.category)
                    ? null
                    : row.original.category;

                return (
                  <TableRow
                    key={row.id}
                    className='cursor-pointer focus-within:bg-accent hover:bg-card max-lg:mb-1.5 max-lg:grid max-lg:grid-cols-[minmax(0,1fr)_auto] max-lg:gap-x-3 max-lg:gap-y-0.5 max-lg:rounded-md max-lg:border! max-lg:bg-card max-lg:p-2'
                    data-testid={`bank-transaction-row-${row.original.id}`}
                    onClick={(event) => {
                      if (event.target instanceof Element && event.target.closest('a,button')) {
                        return;
                      }

                      const trigger = event.currentTarget.querySelector<HTMLButtonElement>(
                        '[data-bank-transaction-detail-trigger]',
                      );
                      trigger?.focus();
                      trigger?.click();
                    }}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const isDescriptionCell = cell.column.id === 'description';

                      return (
                        <TableCell
                          key={cell.id}
                          className={cn(
                            'p-3',
                            cell.column.id === 'bookingDate' && 'max-lg:hidden',
                            cell.column.id === 'amount' &&
                              'max-lg:order-2 max-lg:block max-lg:self-start max-lg:justify-self-end max-lg:border-0 max-lg:p-0',
                            isDescriptionCell &&
                              'max-lg:order-1 max-lg:col-span-1 max-lg:block max-lg:min-w-0 max-lg:border-0 max-lg:p-0',
                            (cell.column.id === 'category' || cell.column.id === 'source') &&
                              'max-lg:hidden',
                          )}
                        >
                          {isDescriptionCell ? (
                            <button
                              type='button'
                              data-bank-transaction-detail-trigger
                              aria-label={`View ${transactionLabel} transaction details`}
                              className='block w-full truncate rounded-sm text-left focus-visible:relative focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-hidden'
                              title={transactionLabel}
                              onClick={(event) =>
                                onTransactionSelect(row.original.id, event.currentTarget)
                              }
                            >
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </button>
                          ) : (
                            flexRender(cell.column.columnDef.cell, cell.getContext())
                          )}
                        </TableCell>
                      );
                    })}
                    <TableCell className='hidden max-lg:order-3 max-lg:col-span-2 max-lg:block max-lg:border-0 max-lg:p-0'>
                      <div
                        data-testid='bank-transaction-mobile-meta'
                        className='flex min-w-0 items-center justify-between gap-3 text-xs text-muted-foreground'
                      >
                        <span className='flex min-w-0 flex-1 items-center gap-1.5 truncate'>
                          <span className='shrink-0'>
                            {formatBankTransactionCompactDate(row.original.bookingDate)}
                          </span>
                          <span aria-hidden='true' className='shrink-0'>
                            ·
                          </span>
                          <BankTransactionCategoryIcon
                            category={category}
                            activity={Boolean(financialEvent)}
                            className='h-5 w-5'
                          />
                          <span
                            data-testid='bank-transaction-mobile-meta-label'
                            className='truncate'
                          >
                            {financialEvent || formatBankTransactionCategory(row.original.category)}
                          </span>
                        </span>
                        <span
                          data-testid='bank-transaction-mobile-meta-right'
                          className='flex max-w-[40%] min-w-0 shrink-0 items-center justify-end gap-1.5 text-right'
                        >
                          <span className='truncate'>{row.original.bankName}</span>
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
        {totalTransactions > 0 && (
          <Pagination
            totalItems={totalTransactions}
            pagination={pagination}
            navigateOptions={{from: '/bank-transactions/'}}
          />
        )}
      </div>
    </>
  );
}

function isBankTransactionSortField(value: string): value is BankTransactionSortField {
  return Object.values(BankTransactionSortField).includes(value as BankTransactionSortField);
}
