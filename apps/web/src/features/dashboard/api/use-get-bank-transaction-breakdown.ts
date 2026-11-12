import {useQuery} from '@tanstack/react-query';
import type {
  BankTransactionBreakdown,
  BankTransactionBreakdownQuery,
  BreakdownDimension,
  BreakdownInterval,
} from '@tempo/contracts';

import {dashboardQueryKeys} from '@/features/banking/api/aggregate-query-keys';
import {api} from '@/utils/api';

import {HOME_REFRESH_INTERVAL_MS} from './refresh-interval';

/** Spending by category or income by source per month or year between two local dates, as of today. */
export const useGetBankTransactionBreakdown = (
  interval: BreakdownInterval,
  by: BreakdownDimension,
  from: string,
  to: string,
  asOf: string,
) => {
  const {data, isPending, isError, error, refetch} = useQuery<BankTransactionBreakdown>({
    queryKey: dashboardQueryKeys.breakdown(interval, by, from, to, asOf),
    queryFn: () => {
      const params = new URLSearchParams({
        interval,
        by,
        from,
        to,
        asOf,
      } satisfies BankTransactionBreakdownQuery);
      return api.get<BankTransactionBreakdown>(`/bank-transactions/breakdown?${params.toString()}`);
    },
    refetchInterval: HOME_REFRESH_INTERVAL_MS,
    staleTime: HOME_REFRESH_INTERVAL_MS,
    refetchOnReconnect: 'always',
  });

  return {breakdown: data, isPending, isError, error, refetch};
};
