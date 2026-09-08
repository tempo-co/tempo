import {keepPreviousData, useQuery} from '@tanstack/react-query';
import {format} from 'date-fns';
import {useState} from 'react';

import {PaginationParams} from '@/types/pagination';
import {api} from '@/utils/api';

import {
  BankTransactionFilterParams,
  BankTransactionSearchParams,
  BankTransactionSortParams,
  BankTransactionsResponse,
  DEFAULT_BANK_TRANSACTION_SORT,
} from '../types/bank-transaction';

export const useGetBankTransactions = (searchParams: BankTransactionSearchParams) => {
  const [pagination, setPagination] = useState<PaginationParams>({
    pageIndex: searchParams.pageIndex,
    pageSize: searchParams.pageSize,
  });
  const [filters, setFilters] = useState<BankTransactionFilterParams>({
    bookingDate: searchParams.bookingDate,
    bankAccountIds: searchParams.bankAccountIds,
    search: searchParams.search,
  });
  const [sort, setSort] = useState<BankTransactionSortParams>(
    searchParams.sort ?? DEFAULT_BANK_TRANSACTION_SORT,
  );

  const {data, isPending, isPlaceholderData, isError, refetch} = useQuery<BankTransactionsResponse>(
    {
      queryKey: ['bank-transactions', pagination, filters, sort],
      queryFn: async () => {
        const params = new URLSearchParams();

        params.append('pagination[pageIndex]', pagination.pageIndex.toString());
        params.append('pagination[pageSize]', pagination.pageSize.toString());

        if (filters.bookingDate?.from) {
          params.append(
            'filter[bookingDate][from]',
            format(filters.bookingDate.from, 'yyyy-MM-dd'),
          );
        }
        if (filters.bookingDate?.to) {
          params.append('filter[bookingDate][to]', format(filters.bookingDate.to, 'yyyy-MM-dd'));
        }
        if (filters.bankAccountIds && filters.bankAccountIds.length > 0) {
          filters.bankAccountIds.forEach((id) => params.append('filter[bankAccountIds][]', id));
        }
        if (filters.search?.trim()) {
          params.append('filter[search]', filters.search.trim());
        }
        if (sort?.by && sort.order) {
          params.append('sort[by]', sort.by);
          params.append('sort[order]', sort.order);
        }

        return await api.get<BankTransactionsResponse>(`/bank-transactions?${params.toString()}`);
      },
      placeholderData: keepPreviousData,
    },
  );

  return {
    data,
    isPending,
    isPlaceholderData,
    isError,
    refetch,
    pagination,
    setPagination,
    filters,
    setFilters,
    sort,
    setSort,
  };
};
