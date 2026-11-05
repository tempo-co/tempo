import {useQuery} from '@tanstack/react-query';
import type {BankTransactionEvents, BankTransactionEventsQuery} from '@tempo/contracts';

import {dashboardQueryKeys} from '@/features/banking/api/aggregate-query-keys';
import {api} from '@/utils/api';

import {HOME_REFRESH_INTERVAL_MS} from './refresh-interval';

/** One-off payments booked between two local dates, judged as of today. */
export const useGetBankTransactionEvents = (from: string, to: string, asOf: string) => {
  const {data, isPending, isError, refetch} = useQuery<BankTransactionEvents>({
    queryKey: dashboardQueryKeys.events(from, to, asOf),
    queryFn: () => {
      const params = new URLSearchParams({from, to, asOf} satisfies BankTransactionEventsQuery);
      return api.get<BankTransactionEvents>(`/bank-transactions/events?${params.toString()}`);
    },
    refetchInterval: HOME_REFRESH_INTERVAL_MS,
    staleTime: HOME_REFRESH_INTERVAL_MS,
    refetchOnReconnect: 'always',
  });

  return {events: data, isPending, isError, refetch};
};
