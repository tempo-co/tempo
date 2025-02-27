import {keepPreviousData, useQuery} from '@tanstack/react-query';
import {PaginationState} from '@tanstack/react-table';
import {useState} from 'react';
import {toast} from 'sonner';

import {Category} from '@/types/category';
import {Transaction} from '@/types/transaction';
import {api} from '@/utils/api';

import {TransactionSearchParams} from '../types/search-params';

export type DateRangeDto = {
  from: Date;
  to?: Date;
};

export type TransactionFilter = {
  categories?: Category[];
  startedAt?: DateRangeDto;
};

export const useGetAllTransactions = (searchParams: TransactionSearchParams) => {
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: searchParams.pageIndex,
    pageSize: searchParams.pageSize,
  });
  const [filters, setFilters] = useState<TransactionFilter>({
    categories: searchParams.categories,
    startedAt: searchParams.startedAt,
  });

  const {data, isPending, isError, isPlaceholderData} = useQuery<{
    transactions: Transaction[];
    total: number;
  }>({
    queryKey: ['transactions', pagination, filters],
    queryFn: async () => {
      const params = new URLSearchParams({
        pageIndex: pagination.pageIndex.toString(),
        pageSize: pagination.pageSize.toString(),
      });

      if (filters.categories) {
        filters.categories.forEach((category) => params.append('categories[]', category));
      }

      if (filters.startedAt) {
        params.append('startedAt[from]', filters.startedAt.from.toISOString());
        if (filters.startedAt.to) {
          params.append('startedAt[to]', filters.startedAt.to.toISOString());
        }
      }

      const response = await api.get(`/transactions?${params.toString()}`);
      return response.json();
    },
    placeholderData: keepPreviousData,
  });

  if (isError) {
    toast.error('There was a problem with your request.', {
      description: 'Your transactions could not be loaded. Please try again.',
    });
  }

  return {
    data,
    isPending,
    isPlaceholderData,
    pagination,
    setPagination,
    filters,
    setFilters,
  };
};
