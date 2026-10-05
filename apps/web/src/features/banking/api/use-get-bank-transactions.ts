import {keepPreviousData, useQuery} from '@tanstack/react-query';
import {useNavigate} from '@tanstack/react-router';
import {format} from 'date-fns';
import {useEffect, useMemo} from 'react';

import {PaginationParams} from '@/types/pagination';
import {api} from '@/utils/api';

import {
  BankTransactionFilterParams,
  BankTransactionSearchParams,
  BankTransactionsResponse,
  DEFAULT_BANK_TRANSACTION_SORT,
} from '../types/bank-transaction';
import {bankQueryKeys} from './query-keys';

const appendArrayFilter = (
  params: URLSearchParams,
  key: string,
  values: readonly string[] | undefined,
) => {
  values?.forEach((value) => params.append(key, value));
};

export const useGetBankTransactions = (
  searchParams: BankTransactionSearchParams,
  {refetchInterval, staleTime}: {refetchInterval?: number; staleTime?: number} = {},
) => {
  const navigate = useNavigate({from: '/bank-transactions/'});
  const pagination: PaginationParams = {
    pageIndex: searchParams.pageIndex,
    pageSize: searchParams.pageSize,
  };
  const filters = useMemo<BankTransactionFilterParams>(
    () => ({
      bookingDate: searchParams.bookingDate,
      bankAccountIds: searchParams.bankAccountIds,
      categories: searchParams.categories,
      categorySources: searchParams.categorySources,
      financialEventTypes: searchParams.financialEventTypes,
      cashFlows: searchParams.cashFlows,
      baseAmount: searchParams.baseAmount,
      categoryStatuses: searchParams.categoryStatuses,
      search: searchParams.search,
    }),
    [
      searchParams.bankAccountIds,
      searchParams.bookingDate,
      searchParams.categories,
      searchParams.categorySources,
      searchParams.financialEventTypes,
      searchParams.cashFlows,
      searchParams.baseAmount,
      searchParams.categoryStatuses,
      searchParams.search,
    ],
  );
  const sort = searchParams.sort ?? DEFAULT_BANK_TRANSACTION_SORT;

  const {data, isPending, isPlaceholderData, isError, error, fetchStatus, refetch} =
    useQuery<BankTransactionsResponse>({
      queryKey: bankQueryKeys.transactions(pagination, filters, sort),
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
        appendArrayFilter(params, 'filter[bankAccountIds][]', filters.bankAccountIds);
        appendArrayFilter(params, 'filter[categories][]', filters.categories);
        appendArrayFilter(params, 'filter[categorySources][]', filters.categorySources);
        appendArrayFilter(params, 'filter[financialEventTypes][]', filters.financialEventTypes);
        appendArrayFilter(params, 'filter[cashFlows][]', filters.cashFlows);
        if (filters.baseAmount) {
          params.append('filter[baseAmount]', filters.baseAmount);
        }
        appendArrayFilter(params, 'filter[categoryStatuses][]', filters.categoryStatuses);
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
      refetchInterval,
      staleTime,
      // Data restored or kept while offline may be outdated, however recently it was fetched.
      refetchOnReconnect: 'always',
    });

  const totalPages = data ? Math.ceil(data.total / pagination.pageSize) : null;
  const canonicalPageIndex = totalPages === null ? null : Math.max(totalPages - 1, 0);

  useEffect(() => {
    if (
      !isPlaceholderData &&
      canonicalPageIndex !== null &&
      totalPages !== null &&
      pagination.pageIndex >= totalPages &&
      pagination.pageIndex !== canonicalPageIndex
    ) {
      void navigate({
        replace: true,
        search: (prev) => ({...prev, pageIndex: canonicalPageIndex}),
      });
    }
  }, [canonicalPageIndex, isPlaceholderData, navigate, pagination.pageIndex, totalPages]);

  return {
    data,
    isPending,
    isPlaceholderData,
    isError,
    error,
    fetchStatus,
    refetch,
    pagination,
    filters,
    sort,
  };
};
