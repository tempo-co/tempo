import {useQuery} from '@tanstack/react-query';

import {api} from '@/utils/api';

import type {BankTransactionSummary} from '../types/bank-transaction-summary';
import {dashboardQueryKeys} from './query-keys';
import {HOME_REFRESH_INTERVAL_MS} from './refresh-interval';

/** Spending pace and categories for `month` (YYYY-MM), cut at the local date `asOf`. */
export const useGetBankTransactionSummary = (month: string, asOf: string) => {
  const {data, isPending, isError, refetch} = useQuery<BankTransactionSummary>({
    queryKey: dashboardQueryKeys.summary(month, asOf),
    queryFn: () => {
      const params = new URLSearchParams({month, asOf});
      return api.get<BankTransactionSummary>(`/bank-transactions/summary?${params.toString()}`);
    },
    refetchInterval: HOME_REFRESH_INTERVAL_MS,
  });

  return {summary: data, isPending, isError, refetch};
};
