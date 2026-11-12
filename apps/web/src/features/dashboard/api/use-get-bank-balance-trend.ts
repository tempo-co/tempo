import {useQuery} from '@tanstack/react-query';
import type {BalanceTrendInterval, BankBalanceTrend} from '@tempo/contracts';

import {dashboardQueryKeys} from '@/features/banking/api/aggregate-query-keys';
import {api} from '@/utils/api';

/**
 * Balances change only when a sync lands, and the connections poll already invalidates Home then, so
 * this heavier query refreshes far less often than the rest of Home.
 */
const BALANCE_TREND_REFRESH_MS = 5 * 60_000;

/** Combined balance at the end of each day, week, month or year between two local dates, as of today. */
export const useGetBankBalanceTrend = (
  interval: BalanceTrendInterval,
  from: string,
  to: string,
  asOf: string,
  {enabled = true}: {enabled?: boolean} = {},
) => {
  const {data, isPending, isError, error, refetch} = useQuery<BankBalanceTrend>({
    enabled,
    queryKey: dashboardQueryKeys.balanceTrend(interval, from, to, asOf),
    queryFn: () => {
      const params = new URLSearchParams({interval, from, to, asOf});
      return api.get<BankBalanceTrend>(`/bank-transactions/balance-trend?${params.toString()}`);
    },
    placeholderData: (previous) => (previous?.interval === interval ? previous : undefined),
    refetchInterval: BALANCE_TREND_REFRESH_MS,
    staleTime: BALANCE_TREND_REFRESH_MS,
    refetchOnReconnect: 'always',
  });

  return {balanceTrend: data, isPending, isError, error, refetch};
};
