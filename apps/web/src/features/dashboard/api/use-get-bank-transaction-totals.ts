import {useQuery} from '@tanstack/react-query';
import type {BankTransactionTotals} from '@tempo/contracts';

import {dashboardQueryKeys} from '@/features/banking/api/aggregate-query-keys';
import {api} from '@/utils/api';

import {HOME_REFRESH_INTERVAL_MS} from './refresh-interval';

/**
 * Spending and income booked between two local dates (`YYYY-MM-DD`), on cash flow's definitions: the totals of
 * every transaction in the range, as the transaction list shows them.
 */
export const useGetBankTransactionTotals = (
  from: string,
  to: string,
  {enabled = true}: {enabled?: boolean} = {},
) => {
  const {data, isError, refetch} = useQuery<BankTransactionTotals>({
    queryKey: dashboardQueryKeys.totals(from, to),
    queryFn: () => {
      const params = new URLSearchParams({
        'filter[bookingDate][from]': from,
        'filter[bookingDate][to]': to,
      });
      return api.get<BankTransactionTotals>(`/bank-transactions/totals?${params.toString()}`);
    },
    enabled,
    refetchInterval: HOME_REFRESH_INTERVAL_MS,
    staleTime: HOME_REFRESH_INTERVAL_MS,
    refetchOnReconnect: 'always',
  });

  return {totals: data, isError, refetch};
};
