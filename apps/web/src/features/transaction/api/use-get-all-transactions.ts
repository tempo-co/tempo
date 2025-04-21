import {keepPreviousData, useQuery} from '@tanstack/react-query';
import {useState} from 'react';

import {PaginationParams} from '@/types/pagination';
import {Transaction} from '@/types/transaction';
import {api} from '@/utils/api';

import {
  TransactionFilterParams,
  TransactionSearchParams,
  TransactionSortParams,
} from '../types/search-params';

type PaginatedTransactionsResponse = {
  transactions: Transaction[];
  total: number;
};

export const useGetAllTransactions = (searchParams: TransactionSearchParams) => {
  const [pagination, setPagination] = useState<PaginationParams>({
    pageIndex: searchParams.pageIndex,
    pageSize: searchParams.pageSize,
  });
  const [filters, setFilters] = useState<TransactionFilterParams>({
    categories: searchParams.categories,
    startedAt: searchParams.startedAt,
  });
  const [sort, setSort] = useState<TransactionSortParams>(searchParams.sort);

  const {data, isPending, isPlaceholderData} = useQuery<PaginatedTransactionsResponse>({
    queryKey: ['transactions', pagination, filters, sort],
    queryFn: async () => {
      const params = new URLSearchParams();

      params.append('pagination[pageIndex]', pagination.pageIndex.toString());
      params.append('pagination[pageSize]', pagination.pageSize.toString());

      if (filters.categories) {
        filters.categories.forEach((category) => params.append('filter[categories][]', category));
      }
      if (filters.startedAt) {
        params.append('filter[startedAt][from]', filters.startedAt.from.toISOString());
        if (filters.startedAt.to) {
          params.append('filter[startedAt][to]', filters.startedAt.to.toISOString());
        }
      }

      if (sort && sort.by && sort.order) {
        params.append('sort[by]', sort.by);
        params.append('sort[order]', sort.order);
      }

      return await api.get<PaginatedTransactionsResponse>(`/transactions?${params.toString()}`);
    },
    placeholderData: keepPreviousData,
  });

  return {
    data,
    isPending,
    isPlaceholderData,
    pagination,
    setPagination,
    filters,
    setFilters,
    sort,
    setSort,
  };
};
