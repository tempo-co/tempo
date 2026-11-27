import {useQuery} from '@tanstack/react-query';
import type {DataCoverage, HomeReadQuery, SpendingPace} from '@tempo/contracts';

import {dashboardQueryKeys} from '@/features/banking/api/aggregate-query-keys';
import {useTransactionPages} from '@/features/banking/api/use-transaction-pages';
import {HOME_REFRESH_INTERVAL_MS} from '@/features/dashboard/api/refresh-interval';
import {api} from '@/utils/api';

/** Home's reads refresh with its other figures, and data kept while offline is refetched on reconnect. */
const FRESHNESS = {
  refetchInterval: HOME_REFRESH_INTERVAL_MS,
  staleTime: HOME_REFRESH_INTERVAL_MS,
  refetchOnReconnect: 'always',
} as const;

/** This month's spending day by day through the last covered day, against the usual pace, as of `asOf`. */
export function useSpendingPace(asOf: string) {
  const {data, isError, error, refetch} = useQuery<SpendingPace>({
    queryKey: dashboardQueryKeys.spendingPace(asOf),
    queryFn: () =>
      api.get<SpendingPace>(
        `/bank-transactions/spending-pace?${new URLSearchParams({asOf} satisfies HomeReadQuery)}`,
      ),
    ...FRESHNESS,
  });
  return {pace: data, isError, error, refetch};
}

/** Which of the last 30 days each account's data covers, as of `asOf`. */
export function useDataCoverage(asOf: string) {
  const {data, isError, error, refetch} = useQuery<DataCoverage>({
    queryKey: dashboardQueryKeys.coverage(asOf),
    queryFn: () =>
      api.get<DataCoverage>(
        `/bank-connections/coverage?${new URLSearchParams({asOf} satisfies HomeReadQuery)}`,
      ),
    ...FRESHNESS,
  });
  return {coverage: data, isError, error, refetch};
}

/** Transactions Home lists, newest first. */
export const RECENT_TRANSACTIONS = 5;

/** The newest transactions, one page. */
export function useRecentTransactions() {
  const query = useTransactionPages(
    dashboardQueryKeys.recentTransactions,
    {},
    {
      pageSize: RECENT_TRANSACTIONS,
      refetchInterval: HOME_REFRESH_INTERVAL_MS,
      staleTime: HOME_REFRESH_INTERVAL_MS,
    },
  );
  return {
    transactions: query.data?.pages[0]?.transactions,
    total: query.data?.pages[0]?.total,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
