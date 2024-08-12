import {
  SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import {useState} from 'react';

import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';
import {BankStatement} from '@/types/bank-statement';

import {bankStatementsTableColumns} from './bank-statements-table-columns';

type BankStatementsTableProps = {
  bankStatements: BankStatement[];
};

export function BankStatementsTable({bankStatements}: BankStatementsTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data: bankStatements,
    columns: bankStatementsTableColumns,
    getCoreRowModel: getCoreRowModel(),
    onSortingChange: setSorting,
    getSortedRowModel: getSortedRowModel(),
    state: {sorting},
  });
  return (
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
        {table.getRowModel().rows?.length ? (
          table.getRowModel().rows.map((row) => (
            <TableRow key={row.id} data-state={row.getIsSelected() && 'selected'}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id} className='p-0'>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))
        ) : (
          <TableRow>
            <TableCell colSpan={bankStatementsTableColumns.length} className='h-24 text-center'>
              No bank statements.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
