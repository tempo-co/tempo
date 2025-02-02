import {PaginationState, Table} from '@tanstack/react-table';
import {ChevronFirst, ChevronLast, ChevronLeft, ChevronRight} from 'lucide-react';
import {Dispatch, SetStateAction, useCallback, useEffect, useMemo} from 'react';

import {Button} from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {Transaction} from '@/types/transaction';

type TransactionTablePaginationProps = {
  table: Table<Transaction>;
  totalTransactions: number;
  pagination: PaginationState;
  setPagination: Dispatch<SetStateAction<PaginationState>>;
};

export function TransactionTablePagination({
  table,
  totalTransactions,
  pagination,
  setPagination,
}: TransactionTablePaginationProps) {
  useEffect(() => {
    const totalPages = Math.ceil(totalTransactions / pagination.pageSize);
    if (pagination.pageIndex >= totalPages) {
      setPagination((prev) => ({
        ...prev,
        pageIndex: Math.max(totalPages - 1, 0),
      }));
    }
  }, [pagination.pageIndex, pagination.pageSize, totalTransactions, setPagination]);

  const startIndex = useMemo(
    () => pagination.pageIndex * pagination.pageSize + 1,
    [pagination.pageIndex, pagination.pageSize],
  );
  const endIndex = useMemo(
    () => Math.min((pagination.pageIndex + 1) * pagination.pageSize, totalTransactions),
    [pagination.pageIndex, pagination.pageSize, totalTransactions],
  );
  const totalPages = useMemo(
    () => Math.ceil(totalTransactions / pagination.pageSize),
    [totalTransactions, pagination.pageSize],
  );

  const handlePageSizeChange = useCallback(
    (value: string) => {
      setPagination((prev) => ({
        ...prev,
        pageSize: Number(value),
      }));
    },
    [setPagination],
  );

  const handleFirstPage = useCallback(() => {
    setPagination((prev) => ({...prev, pageIndex: 0}));
  }, [setPagination]);

  const handlePreviousPage = useCallback(() => {
    setPagination((prev) => ({...prev, pageIndex: Math.max(prev.pageIndex - 1, 0)}));
  }, [setPagination]);

  const handleNextPage = useCallback(() => {
    setPagination((prev) => ({...prev, pageIndex: prev.pageIndex + 1}));
  }, [setPagination]);

  const handleLastPage = useCallback(() => {
    setPagination((prev) => ({...prev, pageIndex: totalPages - 1}));
  }, [setPagination, totalPages]);

  const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50];

  return (
    <div className='mt-4 flex items-center justify-end gap-10'>
      <div className='flex items-center space-x-6 lg:space-x-8'>
        <div className='flex items-center space-x-2'>
          <p className='text-sm font-medium'>Rows per page</p>
          <Select
            value={`${table.getState().pagination.pageSize}`}
            onValueChange={handlePageSizeChange}
          >
            <SelectTrigger className='h-8 w-[70px]'>
              <SelectValue placeholder={table.getState().pagination.pageSize} />
            </SelectTrigger>
            <SelectContent side='top'>
              {PAGE_SIZE_OPTIONS.map((pageSize) => (
                <SelectItem key={pageSize} value={`${pageSize}`}>
                  {pageSize}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className='text-sm'>
        {startIndex}-{endIndex} of {totalTransactions}
      </p>
      <div className='space-x-2'>
        <Button
          onClick={handleFirstPage}
          disabled={pagination.pageIndex < 1}
          variant='outline'
          className='h-8 w-8 p-0'
        >
          <span className='sr-only'>Go to first page</span>
          <ChevronFirst className='h-4 w-4' />
        </Button>
        <Button
          onClick={handlePreviousPage}
          disabled={pagination.pageIndex < 1}
          variant='outline'
          className='h-8 w-8 p-0'
        >
          <span className='sr-only'>Go to previous page</span>
          <ChevronLeft className='h-4 w-4' />
        </Button>
        <Button
          onClick={handleNextPage}
          disabled={!table.getCanNextPage()}
          variant='outline'
          className='h-8 w-8 p-0'
        >
          <span className='sr-only'>Go to next page</span>
          <ChevronRight className='h-4 w-4' />
        </Button>
        <Button
          onClick={handleLastPage}
          disabled={!table.getCanNextPage()}
          variant='outline'
          className='h-8 w-8 p-0'
        >
          <span className='sr-only'>Go to last page</span>
          <ChevronLast className='h-4 w-4' />
        </Button>
      </div>
    </div>
  );
}
