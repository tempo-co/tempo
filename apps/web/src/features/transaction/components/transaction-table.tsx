import {
  PaginationState,
  SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import {CreditCard} from 'lucide-react';
import {Dispatch, SetStateAction, useEffect, useState} from 'react';

import {TablePagination} from '@/components/shared/table-pagination';
import {Button} from '@/components/ui/button';
import {Progress} from '@/components/ui/progress';
import {Skeleton} from '@/components/ui/skeleton';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';
import {Transaction} from '@/types/transaction';
import {cn} from '@/utils/cn';

import {TransactionFilter} from '../api/use-get-all-transactions';
import {TransactionCategoryFilter} from './transaction-category-filter';
import {TransactionClearAllFilters} from './transaction-clear-all-filters';
import {TransactionDateFilter} from './transaction-date-filter';
import {transactionsTableColumns} from './transaction-table-columns';

type TransactionsTableProps = {
  transactions: Transaction[];
  totalTransactions: number;
  isPending: boolean;
  isPlaceholderData: boolean;
  pagination: PaginationState;
  setPagination: Dispatch<SetStateAction<PaginationState>>;
  filters: TransactionFilter;
  setFilters: React.Dispatch<React.SetStateAction<TransactionFilter>>;
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
}: TransactionsTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    isPlaceholderData ? setProgress(100) : setProgress(0);
  }, [isPlaceholderData]);

  const table = useReactTable({
    data: transactions,
    columns: transactionsTableColumns,
    getCoreRowModel: getCoreRowModel(),
    onSortingChange: setSorting,
    getSortedRowModel: getSortedRowModel(),
    onPaginationChange: setPagination,
    manualPagination: true,
    state: {sorting, pagination},
    rowCount: totalTransactions,
  });

  const isFilteringApplied = Object.values(filters).some((filter) => {
    return Array.isArray(filter) ? filter.length > 0 : !!filter;
  });
  const isEmptyState =
    totalTransactions === 0 && !isPending && !isPlaceholderData && !isFilteringApplied;

  if (isEmptyState) {
    return (
      <div className='flex flex-col items-center gap-4'>
        <div className='flex flex-col items-center'>
          <CreditCard className='h-24 w-24 text-muted' />
          <p>No transactions.</p>
        </div>
        <div className='flex gap-4'>
          <Button variant='outline'>Add transaction</Button>
          <Button>Upload bank statement</Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className='my-4 flex gap-4'>
        <TransactionCategoryFilter filters={filters} setFilters={setFilters} />
        <TransactionDateFilter />
        {isFilteringApplied && <TransactionClearAllFilters setFilters={setFilters} />}
      </div>
      <div className='relative mb-10'>
        <Progress
          value={progress}
          className='absolute left-0 right-0 top-0 z-10 h-[2px] rounded-b-none rounded-t-md bg-transparent'
        />
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
            {isPending ? (
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
              ))
            ) : table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={transactionsTableColumns.length} className='h-24 text-center'>
                  No results.
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() && 'selected'}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className='p-3'>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
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
