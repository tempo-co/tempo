import {
  PaginationState,
  SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import {ChevronFirst, ChevronLast, ChevronLeft, ChevronRight} from 'lucide-react';
import {Dispatch, SetStateAction, useEffect, useState} from 'react';

import {Button} from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {Skeleton} from '@/components/ui/skeleton';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';
import {Transaction} from '@/types/transaction';
import {cn} from '@/utils/cn';

import {transactionsTableColumns} from './transaction-table-columns';

type TransactionsTableProps = {
  transactions: Transaction[];
  total: number;
  pagination: PaginationState;
  setPagination: Dispatch<SetStateAction<PaginationState>>;
  isPlaceholderData: boolean;
  isPending: boolean;
};

export function TransactionsTable({
  transactions,
  total,
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
    rowCount: total,
  });

  useEffect(() => {
    const totalPages = Math.ceil(total / pagination.pageSize);
    if (pagination.pageIndex >= totalPages) {
      setPagination((prev) => ({
        ...prev,
        pageIndex: totalPages - 1,
      }));
    }
  }, [pagination, total, setPagination]);

  const startIndex = pagination.pageIndex * pagination.pageSize + 1;
  const endIndex = Math.min((pagination.pageIndex + 1) * pagination.pageSize, total);

  const totalPages = Math.ceil(total / pagination.pageSize);

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
          {isPending || isPlaceholderData ? (
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

      <div className='mt-4 flex items-center justify-end gap-10'>
        <div className='flex items-center space-x-6 lg:space-x-8'>
          <div className='flex items-center space-x-2'>
            <p className='text-sm font-medium'>Rows per page</p>
            <Select
              value={`${table.getState().pagination.pageSize}`}
              onValueChange={(value) => {
                setPagination((prev) => ({
                  ...prev,
                  pageSize: Number(value),
                }));
              }}
            >
              <SelectTrigger className='h-8 w-[70px]'>
                <SelectValue placeholder={table.getState().pagination.pageSize} />
              </SelectTrigger>
              <SelectContent side='top'>
                {[10, 20, 30, 40, 50].map((pageSize) => (
                  <SelectItem key={pageSize} value={`${pageSize}`}>
                    {pageSize}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className='text-sm'>
          {startIndex}-{endIndex} of {total}
        </p>
        <div className='space-x-2'>
          <Button
            onClick={() => setPagination((prev) => ({...prev, pageIndex: 0}))}
            disabled={pagination.pageIndex < 1}
            variant='outline'
            className='h-8 w-8 p-0'
          >
            <span className='sr-only'>Go to first page</span>
            <ChevronFirst className='h-4 w-4' />
          </Button>
          <Button
            onClick={() =>
              setPagination((prev) => ({...prev, pageIndex: Math.max(prev.pageIndex - 1, 0)}))
            }
            disabled={pagination.pageIndex < 1}
            variant='outline'
            className='h-8 w-8 p-0'
          >
            <span className='sr-only'>Go to previous page</span>
            <ChevronLeft className='h-4 w-4' />
          </Button>
          <Button
            onClick={() => setPagination((prev) => ({...prev, pageIndex: prev.pageIndex + 1}))}
            disabled={!table.getCanNextPage()}
            variant='outline'
            className='h-8 w-8 p-0'
          >
            <span className='sr-only'>Go to next page</span>
            <ChevronRight className='h-4 w-4' />
          </Button>
          <Button
            onClick={() => setPagination((prev) => ({...prev, pageIndex: totalPages - 1}))}
            disabled={!table.getCanNextPage()}
            variant='outline'
            className='h-8 w-8 p-0'
          >
            <span className='sr-only'>Go to last page</span>
            <ChevronLast className='h-4 w-4' />
          </Button>
        </div>
      </div>
    </>
  );
}
