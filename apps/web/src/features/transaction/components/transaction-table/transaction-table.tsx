import {Link, useNavigate} from '@tanstack/react-router';
import {flexRender, getCoreRowModel, useReactTable} from '@tanstack/react-table';
import {SearchX} from 'lucide-react';
import {Dispatch, SetStateAction} from 'react';

import CreditCards from '@/components/shared/illustrations/credit-cards';
import {LoadingBar} from '@/components/shared/loading-bar';
import {TablePagination} from '@/components/shared/table-pagination';
import {Skeleton} from '@/components/ui/skeleton';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';
import {PaginationParams} from '@/types/pagination';
import {Transaction} from '@/types/transaction';
import {cn} from '@/utils/cn';

import {TransactionFilterParams, TransactionSortParams} from '../../types/search-params';
import {createSortingHandler, mapSortToSortingState} from '../../utils/handle-sort';
import {TransactionCategoryFilter} from './transaction-category-filter';
import {TransactionClearAllFiltersButton} from './transaction-clear-all-filters';
import {TransactionDateFilter} from './transaction-date-filter';
import {transactionsTableColumns} from './transaction-table-columns';

type TransactionsTableProps = {
  transactions: Transaction[];
  totalTransactions: number;
  isPending: boolean;
  isPlaceholderData: boolean;
  pagination: PaginationParams;
  setPagination: Dispatch<SetStateAction<PaginationParams>>;
  filters: TransactionFilterParams;
  setFilters: React.Dispatch<React.SetStateAction<TransactionFilterParams>>;
  sort: TransactionSortParams;
  setSort: React.Dispatch<React.SetStateAction<TransactionSortParams>>;
};

export function TransactionsTable({
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
}: TransactionsTableProps) {
  const navigate = useNavigate({from: '/transactions'});

  const table = useReactTable({
    data: transactions,
    columns: transactionsTableColumns,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualFiltering: true,
    manualPagination: true,
    state: {pagination, sorting: mapSortToSortingState(sort)},
    rowCount: totalTransactions,
    onSortingChange: createSortingHandler(setSort, navigate),
  });

  const isFilteringApplied = Object.values(filters).some((filter) => {
    return Array.isArray(filter) ? filter.length > 0 : !!filter;
  });
  const isEmptyState =
    totalTransactions === 0 && !isPending && !isPlaceholderData && !isFilteringApplied;

  if (isEmptyState) {
    return (
      <div className='mt-8 flex flex-col items-center'>
        <CreditCards className='h-60' />
        <div className='flex flex-col items-center text-base'>
          <p className='mb-2 text-2xl'>No transactions</p>
          <p className='text-muted-foreground'>You do not have any transactions yet.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className='my-4 flex gap-4'>
        <TransactionCategoryFilter filters={filters} setFilters={setFilters} />
        <TransactionDateFilter filters={filters} setFilters={setFilters} />
        {isFilteringApplied && (
          <TransactionClearAllFiltersButton
            setFilters={setFilters}
            size='sm'
            className='h-8'
            variant='secondary'
          />
        )}
      </div>
      <div className='relative mb-10'>
        <LoadingBar isPending={isPlaceholderData} />
        <Table>
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
            {isPending &&
              Array.from({length: pagination.pageSize}).map((_, index) => (
                <TableRow key={index}>
                  {transactionsTableColumns.map((column, colIndex) => (
                    <TableCell
                      key={colIndex}
                      className={cn(
                        'px-3 py-4',
                        (column as {accessorKey: string}).accessorKey === 'amount' &&
                          'flex justify-end',
                      )}
                    >
                      <Skeleton
                        className={cn(
                          'h-[1.25rem] w-[8rem] rounded-full',
                          (column as {accessorKey: string}).accessorKey === 'amount' && 'w-[5rem]',
                          (column as {accessorKey: string}).accessorKey === 'description' &&
                            'w-[20rem]',
                        )}
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            {totalTransactions === 0 && isFilteringApplied ? (
              <TableRow>
                <TableCell colSpan={transactionsTableColumns.length} className='h-24 text-center'>
                  <div className='my-4 flex flex-col items-center gap-4'>
                    <SearchX className='h-12 w-12 text-muted-foreground' />
                    <div>
                      <p className='mb-2 text-base'>No transactions found</p>
                      <p className='text-muted-foreground'>
                        The applied filters did not match any transactions.
                      </p>
                    </div>
                    <TransactionClearAllFiltersButton setFilters={setFilters} />
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && 'selected'}
                  className='cursor-pointer hover:bg-card'
                >
                  <Link
                    to='/transactions/$transactionId'
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
          <TablePagination
            table={table}
            totalItems={totalTransactions}
            pagination={pagination}
            setPagination={setPagination}
            navigateOptions={{from: '/transactions'}}
          />
        )}
      </div>
    </>
  );
}
