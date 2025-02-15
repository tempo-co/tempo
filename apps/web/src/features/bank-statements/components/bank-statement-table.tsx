import {
  PaginationState,
  SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import {FileText} from 'lucide-react';
import {Dispatch, SetStateAction, useState} from 'react';

import {Skeleton} from '@/components/ui/skeleton';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';
import {BankStatement} from '@/types/bank-statement';
import {cn} from '@/utils/cn';

import {bankStatementTableColumns} from './bank-statement-table-columns';
import {BankStatementUploadDialog} from './bank-statement-upload-dialog';
import {TablePagination} from './table-pagination';

type BankStatementTableProps = {
  bankStatements: BankStatement[];
  totalBankStatements: number;
  pagination: PaginationState;
  setPagination: Dispatch<SetStateAction<PaginationState>>;
  isPlaceholderData: boolean;
  isPending: boolean;
};

export function BankStatementTable({
  bankStatements,
  totalBankStatements,
  pagination,
  setPagination,
  isPlaceholderData,
  isPending,
}: BankStatementTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data: bankStatements,
    columns: bankStatementTableColumns,
    getCoreRowModel: getCoreRowModel(),
    onSortingChange: setSorting,
    getSortedRowModel: getSortedRowModel(),
    onPaginationChange: setPagination,
    manualPagination: true,
    state: {sorting, pagination},
    rowCount: totalBankStatements,
  });

  if (totalBankStatements === 0 && !isPending && !isPlaceholderData) {
    return (
      <div className='flex flex-col items-center gap-4'>
        <div className='flex flex-col items-center'>
          <FileText className='mb-1 h-24 w-24 text-muted' />
          <p>No bank statements.</p>
        </div>
        <BankStatementUploadDialog pagination={pagination} />
      </div>
    );
  }

  return (
    <>
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} className='hover:bg-background'>
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
          {isPlaceholderData || isPending
            ? Array.from({length: pagination.pageSize}).map((_, index) => (
                <TableRow key={index}>
                  {bankStatementTableColumns.map((column, colIndex) => (
                    <TableCell
                      key={colIndex}
                      className={cn(
                        'px-3 py-4',
                        (column as {id: string}).id === 'actions' && 'flex justify-end',
                      )}
                    >
                      <Skeleton
                        className={cn(
                          'h-[1.25rem] w-[8rem] rounded-full',
                          (column as {id: string}).id === 'actions' && 'hidden',
                        )}
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() && 'selected'}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className='p-0'>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
        </TableBody>
      </Table>
      {totalBankStatements > 0 && (
        <TablePagination
          table={table}
          totalItems={totalBankStatements}
          pagination={pagination}
          setPagination={setPagination}
        />
      )}
    </>
  );
}
