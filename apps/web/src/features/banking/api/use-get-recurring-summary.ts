import {useQuery} from '@tanstack/react-query';

import {HOME_REFRESH_INTERVAL_MS} from '@/features/dashboard/api/refresh-interval';
import {api} from '@/utils/api';

import type {RecurringSummary} from '../types/recurring-series';
import {recurringQueryKeys} from './recurring-query-keys';

/** Recurring bills and income totals with the next payments due, judged at `asOf`. */
export const useGetRecurringSummary = (asOf: string) => {
  const {data, isPending, isError, refetch} = useQuery<RecurringSummary>({
    queryKey: recurringQueryKeys.summary(asOf),
    queryFn: () =>
      api.get<RecurringSummary>(`/recurring-series/summary?${new URLSearchParams({asOf})}`),
    // Home's other figures refresh on this interval; totals change when conversion finishes too.
    refetchInterval: HOME_REFRESH_INTERVAL_MS,
    staleTime: HOME_REFRESH_INTERVAL_MS,
    // Data restored or kept while offline may be outdated, however recently it was fetched.
    refetchOnReconnect: 'always',
  });
  return {summary: data, isPending, isError, refetch};
};
