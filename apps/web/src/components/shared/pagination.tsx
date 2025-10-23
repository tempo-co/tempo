import {NavigateOptions, useNavigate} from '@tanstack/react-router';
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
import {PAGE_SIZE_OPTIONS, PaginationParams} from '@/types/pagination';

type PaginationProps = {
  totalItems: number;
  pagination: PaginationParams;
  setPagination: Dispatch<SetStateAction<PaginationParams>>;
  navigateOptions: NavigateOptions;
  pageSizeOptions?: number[];
};

export function Pagination({
  totalItems,
  pagination,
  setPagination,
  navigateOptions,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
}: PaginationProps) {
  const navigate = useNavigate(navigateOptions);

  const totalPages = useMemo(
    () => Math.ceil(totalItems / pagination.pageSize),
    [totalItems, pagination.pageSize],
  );

  useEffect(() => {
    if (pagination.pageIndex >= totalPages) {
      setPagination((prev) => ({...prev, pageIndex: Math.max(totalPages - 1, 0)}));
    }
  }, [pagination.pageIndex, totalPages, setPagination]);

  const startIndex = useMemo(
    () => pagination.pageIndex * pagination.pageSize + 1,
    [pagination.pageIndex, pagination.pageSize],
  );
  const endIndex = useMemo(
    () => Math.min((pagination.pageIndex + 1) * pagination.pageSize, totalItems),
    [pagination.pageIndex, pagination.pageSize, totalItems],
  );

  const canGoNext = useMemo(
    () => pagination.pageIndex < totalPages - 1,
    [pagination.pageIndex, totalPages],
  );

  const handlePageSizeChange = useCallback(
    async (pageSize: string) => {
      await navigate({search: (prev) => ({...prev, pageSize: Number(pageSize), pageIndex: 0})});
      setPagination({pageIndex: 0, pageSize: Number(pageSize)});
    },
    [navigate, setPagination],
  );

  const handleFirstPage = useCallback(async () => {
    await navigate({search: (prev) => ({...prev, pageIndex: 0})});
    setPagination((prev) => ({...prev, pageIndex: 0}));
  }, [navigate, setPagination]);

  const handlePreviousPage = useCallback(async () => {
    const newPageIndex = Math.max(pagination.pageIndex - 1, 0);
    await navigate({search: (prev) => ({...prev, pageIndex: newPageIndex})});
    setPagination((prev) => ({...prev, pageIndex: newPageIndex}));
  }, [navigate, pagination.pageIndex, setPagination]);

  const handleNextPage = useCallback(async () => {
    const newPageIndex = pagination.pageIndex + 1;
    await navigate({search: (prev) => ({...prev, pageIndex: newPageIndex})});
    setPagination((prev) => ({...prev, pageIndex: newPageIndex}));
  }, [navigate, pagination.pageIndex, setPagination]);

  const handleLastPage = useCallback(async () => {
    const newPageIndex = totalPages - 1;
    await navigate({search: (prev) => ({...prev, pageIndex: newPageIndex})});
    setPagination((prev) => ({...prev, pageIndex: newPageIndex}));
  }, [navigate, setPagination, totalPages]);

  return (
    <div className='mt-4 flex items-center justify-end gap-10'>
      <div className='flex items-center space-x-6 lg:space-x-8'>
        <div className='flex items-center space-x-2'>
          <p className='text-sm font-medium'>Rows per page</p>
          <Select value={`${pagination.pageSize}`} onValueChange={handlePageSizeChange}>
            <SelectTrigger className='h-8 w-[70px]'>
              <SelectValue placeholder={pagination.pageSize} />
            </SelectTrigger>
            <SelectContent side='top'>
              {pageSizeOptions.map((pageSize) => (
                <SelectItem key={pageSize} value={`${pageSize}`}>
                  {pageSize}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className='text-sm'>
        {startIndex}-{endIndex} of {totalItems}
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
          disabled={!canGoNext}
          variant='outline'
          className='h-8 w-8 p-0'
        >
          <span className='sr-only'>Go to next page</span>
          <ChevronRight className='h-4 w-4' />
        </Button>
        <Button
          onClick={handleLastPage}
          disabled={!canGoNext}
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
