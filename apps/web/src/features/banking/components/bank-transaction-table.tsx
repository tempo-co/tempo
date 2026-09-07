import {Link, useNavigate} from '@tanstack/react-router';
import {SortingState, flexRender, getCoreRowModel, useReactTable} from '@tanstack/react-table';
import {Search, SearchX} from 'lucide-react';
import {Dispatch, SetStateAction} from 'react';

import {EmptyState} from '@/components/shared/layout/app-empty-state';
import {LoadingBar} from '@/components/shared/loading-bar';
import {Pagination} from '@/components/shared/pagination';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Skeleton} from '@/components/ui/skeleton';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';
import {PaginationParams} from '@/types/pagination';

import {
  BankTransaction,
  BankTransactionFilterParams,
  BankTransactionSortField,
  BankTransactionSortOrder,
  BankTransactionSortParams,
  DEFAULT_BANK_TRANSACTION_SORT,
} from '../types/bank-transaction';
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
}: BankTransactionTableProps) {
  const navigate = useNavigate({from: '/bank-transactions/'});
  const isFilteringApplied =
    !!filters.bookingDate || (filters.bankAccountIds?.length ?? 0) > 0 || !!filters.search?.trim();

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

  const updateSearch = (value: string) => {
    const search = value.trim() || undefined;
    void navigate({search: (prev) => ({...prev, search, pageIndex: 0})});
    setFilters((previousFilters) => ({...previousFilters, search}));
  };

  if (isPending) {
    return <Skeleton className='h-[22rem] w-full rounded-lg bg-card' />;
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
      <div className='my-4 flex flex-wrap items-center gap-4'>
        <div className='relative min-w-[14rem] flex-1 md:max-w-sm'>
          <Search className='absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
          <Input
            value={filters.search || ''}
            onChange={(event) => updateSearch(event.target.value)}
            placeholder='Search transactions...'
            className='h-8 pl-9'
            data-testid='bank-transactions-search'
          />
        </div>
        <BankTransactionDateFilter filters={filters} setFilters={setFilters} />
        <BankTransactionAccountFilter filters={filters} setFilters={setFilters} />
        {isFilteringApplied && (
          <Button variant='secondary' size='sm' className='h-8' onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </div>
      <div className='relative mb-10'>
        <LoadingBar isPending={isPlaceholderData} />
        <Table data-testid='bank-transactions-table'>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className='p-0'>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
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
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className='cursor-pointer hover:bg-card'
                  data-testid={`bank-transaction-row-${row.original.id}`}
                >
                  <Link
                    to='/bank-transactions/$transactionId'
                    params={{transactionId: row.original.id}}
                    style={{all: 'unset', display: 'contents'}}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className='p-3'>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </Link>
                </TableRow>
              ))
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

function isBankTransactionSortField(value: string): value is BankTransactionSortField {
  return Object.values(BankTransactionSortField).includes(value as BankTransactionSortField);
}
