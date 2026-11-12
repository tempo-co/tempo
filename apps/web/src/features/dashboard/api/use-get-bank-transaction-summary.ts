import {useQuery} from '@tanstack/react-query';
import type {BankTransactionSummary} from '@tempo/contracts';

import {dashboardQueryKeys} from '@/features/banking/api/aggregate-query-keys';
import {api} from '@/utils/api';

import {HOME_REFRESH_INTERVAL_MS} from './refresh-interval';

/**
 * `month` (YYYY-MM) cut at the local date `asOf`, with each category's usual by that day of the month. Requested
 * only while `enabled`.
 */
export const useGetBankTransactionSummary = (
  month: string,
  asOf: string,
  {enabled = true}: {enabled?: boolean} = {},
) => {
  const {data, isPending, isError, error, refetch} = useQuery<BankTransactionSummary>({
    enabled,
    queryKey: dashboardQueryKeys.summary(month, asOf),
    queryFn: () => {
      const params = new URLSearchParams({month, asOf});
      return api.get<BankTransactionSummary>(`/bank-transactions/summary?${params.toString()}`);
    },
    refetchInterval: HOME_REFRESH_INTERVAL_MS,
    staleTime: HOME_REFRESH_INTERVAL_MS,
    refetchOnReconnect: 'always',
  });

  return {summary: data, isPending, isError, error, refetch};
};
