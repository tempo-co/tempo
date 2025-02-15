import {
  PaginationState,
  SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import {CreditCard} from 'lucide-react';
import {Dispatch, SetStateAction, useState} from 'react';

import {Button} from '@/components/ui/button';
import {Skeleton} from '@/components/ui/skeleton';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';
import {Transaction} from '@/types/transaction';
import {cn} from '@/utils/cn';

import {transactionsTableColumns} from './transaction-table-columns';
import {TransactionTablePagination} from './transaction-table-pagination';

type TransactionsTableProps = {
  transactions: Transaction[];
  totalTransactions: number;
  pagination?: PaginationState;
  setPagination?: Dispatch<SetStateAction<PaginationState>>;
  isPlaceholderData?: boolean;
  isPending?: boolean;
};

export function TransactionsTable({
  transactions,
  totalTransactions,
  pagination,
  setPagination,
  isPlaceholderData,
  isPending,
}: TransactionsTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);

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

  if (totalTransactions === 0 && !isPending && !isPlaceholderData) {
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
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                return (
                  <TableHead key={header.id} className='p-0'>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {(isPlaceholderData || isPending) && pagination ? (
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
                      )}
                    />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id} data-state={row.getIsSelected() && 'selected'}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className='p-3'>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={transactionsTableColumns.length} className='h-24 text-center'>
                No transactions.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {pagination && setPagination && totalTransactions > 0 && (
        <TransactionTablePagination
          table={table}
          totalTransactions={totalTransactions}
          pagination={pagination}
          setPagination={setPagination}
        />
      )}
    </>
  );
}
