import {useNavigate} from '@tanstack/react-router';
import {SortingState, flexRender, getCoreRowModel, useReactTable} from '@tanstack/react-table';
import {RefreshCw, Search, SearchX} from 'lucide-react';
import {Dispatch, SetStateAction, useEffect, useState} from 'react';

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
  formatBankTransactionCompactDate,
  formatBankTransactionType,
  resolveBankTransactionDisplayTitle,
} from '../utils/formatters';
import {BankTransactionAccountFilter} from './bank-transaction-account-filter';
import {BankTransactionDateFilter} from './bank-transaction-date-filter';
import {bankTransactionTableColumns} from './bank-transaction-table-columns';

type BankTransactionTableProps = {
  transactions: BankTransaction[];
  totalTransactions: number;
  isPending: boolean;
  isPlaceholderData: boolean;
  pagination: PaginationParams;
  setPagination: Dispatch<SetStateAction<PaginationParams>>;
  filters: BankTransactionFilterParams;
  setFilters: React.Dispatch<React.SetStateAction<BankTransactionFilterParams>>;
  sort: BankTransactionSortParams;
  setSort: React.Dispatch<React.SetStateAction<BankTransactionSortParams>>;
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
  setPagination,
  filters,
  setFilters,
  sort,
  setSort,
  isError,
  onRetry,
  onTransactionSelect,
}: BankTransactionTableProps) {
  const navigate = useNavigate({from: '/bank-transactions/'});
  const [searchInput, setSearchInput] = useState(filters.search || '');
  const isFilteringApplied =
    !!filters.bookingDate || (filters.bankAccountIds?.length ?? 0) > 0 || !!filters.search?.trim();

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
      setFilters((previousFilters) => ({...previousFilters, search}));
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [filters.search, navigate, searchInput, setFilters]);

  const handleSortingChange = (
    updaterOrValue: SortingState | ((prev: SortingState) => SortingState),
  ) => {
    const currentSorting: SortingState = sort
      ? [{id: sort.by, desc: sort.order === BankTransactionSortOrder.DESC}]
      : [];
    const updatedSorting =
      typeof updaterOrValue === 'function' ? updaterOrValue(currentSorting) : updaterOrValue;
    const firstSort = updatedSorting[0];
    const nextSort =
      firstSort && isBankTransactionSortField(firstSort.id)
        ? {
            by: firstSort.id,
            order: firstSort.desc ? BankTransactionSortOrder.DESC : BankTransactionSortOrder.ASC,
          }
        : DEFAULT_BANK_TRANSACTION_SORT;

    void navigate({search: (prev) => ({...prev, sort: nextSort, pageIndex: 0})});
    setSort(nextSort);
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
      sorting: sort ? [{id: sort.by, desc: sort.order === BankTransactionSortOrder.DESC}] : [],
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
        search: undefined,
        pageIndex: 0,
      }),
    });
    setFilters({bookingDate: undefined, bankAccountIds: [], search: undefined});
  };

  if (isPending) {
    return <Skeleton className='h-[22rem] w-full rounded-lg bg-card' />;
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
      <div className='mb-5 flex flex-wrap items-center gap-3 max-md:mb-4 max-md:gap-2'>
        <div className='relative min-w-[14rem] flex-1 md:max-w-sm'>
          <Search className='absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder='Search transactions...'
            aria-label='Search transactions'
            className='h-10 pl-9 sm:h-8'
            data-testid='bank-transactions-search'
          />
        </div>
        <div className='flex w-full gap-2 md:contents'>
          <BankTransactionDateFilter
            filters={filters}
            setFilters={setFilters}
            className='max-md:min-w-0 max-md:flex-1'
          />
          <BankTransactionAccountFilter
            filters={filters}
            setFilters={setFilters}
            className='max-md:min-w-0 max-md:flex-1'
          />
        </div>
        {isFilteringApplied && (
          <Button variant='secondary' size='sm' className='h-10 sm:h-8' onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </div>
      <div className='relative mb-10'>
        <LoadingBar isPending={isPlaceholderData} />
        <Table
          data-testid='bank-transactions-table'
          aria-label='Bank transactions'
          wrapperClassName='max-md:rounded-none max-md:border-0'
          className='max-md:block max-md:w-full'
        >
          <TableCaption className='sr-only'>
            Bank transaction records. Select a transaction description to view its full details.
          </TableCaption>
          <TableHeader className='max-md:sr-only'>
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
          <TableBody className='max-md:block'>
            {totalTransactions === 0 && isFilteringApplied ? (
              <TableRow>
                <TableCell
                  colSpan={bankTransactionTableColumns.length}
                  className='h-24 text-center'
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
                const transactionLabel = getTransactionLabel(row.original);
                const mobileTransactionType = getMobileTransactionType(row.original);

                return (
                  <TableRow
                    key={row.id}
                    className='cursor-pointer focus-within:bg-accent hover:bg-card max-md:mb-1.5 max-md:grid max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-x-3 max-md:gap-y-0.5 max-md:rounded-md max-md:border max-md:bg-card max-md:p-2'
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
                            cell.column.id === 'bookingDate' && 'max-md:hidden',
                            cell.column.id === 'amount' &&
                              'max-md:order-2 max-md:block max-md:self-start max-md:justify-self-end max-md:border-0 max-md:p-0',
                            isDescriptionCell &&
                              'max-md:order-1 max-md:col-span-1 max-md:block max-md:min-w-0 max-md:border-0 max-md:p-0',
                            (cell.column.id === 'valueDate' ||
                              cell.column.id === 'transactionType' ||
                              cell.column.id === 'source') &&
                              'max-md:hidden',
                          )}
                        >
                          {isDescriptionCell ? (
                            <button
                              type='button'
                              data-bank-transaction-detail-trigger
                              aria-label={`View ${transactionLabel} transaction details`}
                              className='block w-full truncate rounded-sm text-left focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
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
                    <TableCell className='hidden max-md:order-3 max-md:col-span-2 max-md:block max-md:border-0 max-md:p-0'>
                      <div
                        data-testid='bank-transaction-mobile-meta'
                        className='flex min-w-0 items-center justify-between gap-3 text-xs text-muted-foreground'
                      >
                        <span className='min-w-0 flex-1 truncate'>
                          {formatBankTransactionCompactDate(row.original.bookingDate)}
                          <span aria-hidden='true'> · </span>
                          {getMobileTransactionAccount(row.original)}
                        </span>
                        <span
                          data-testid='bank-transaction-mobile-meta-right'
                          className='flex min-w-0 max-w-[55%] shrink-0 items-center justify-end gap-1.5 text-right'
                        >
                          <span className='truncate'>{row.original.bankName}</span>
                          {mobileTransactionType && (
                            <>
                              <span aria-hidden='true'>·</span>
                              <span className='shrink-0'>{mobileTransactionType}</span>
                            </>
                          )}
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
            setPagination={setPagination}
            navigateOptions={{from: '/bank-transactions/'}}
          />
        )}
      </div>
    </>
  );
}

function getTransactionLabel(transaction: BankTransaction) {
  return resolveBankTransactionDisplayTitle(transaction);
}

function getMobileTransactionAccount(transaction: BankTransaction) {
  return transaction.bankAccountAlias || transaction.bankAccountName || 'Bank account';
}

function getMobileTransactionType(transaction: BankTransaction) {
  const type = formatBankTransactionType(transaction.transactionType);
  return type === 'Other' ? null : type;
}

function isBankTransactionSortField(value: string): value is BankTransactionSortField {
  return Object.values(BankTransactionSortField).includes(value as BankTransactionSortField);
}
