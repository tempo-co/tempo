import {useQuery} from '@tanstack/react-query';

import {api} from '@/utils/api';

import type {RecurringSeriesLists} from '../types/recurring-series';
import {recurringQueryKeys} from './recurring-query-keys';

/** Recurring bills and income detected in the owner's history; late and ended are judged at `asOf`. */
export const useGetRecurringSeries = (asOf: string) => {
  const {data, isPending, isError, error, fetchStatus, refetch} = useQuery<RecurringSeriesLists>({
    queryKey: recurringQueryKeys.lists(asOf),
    queryFn: () =>
      api.get<RecurringSeriesLists>(`/recurring-series?${new URLSearchParams({asOf})}`),
    // Data restored or kept while offline may be outdated, however recently it was fetched.
    refetchOnReconnect: 'always',
  });

  return {data, isPending, isError, error, fetchStatus, refetch};
};
