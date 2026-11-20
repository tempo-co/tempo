import {useQuery} from '@tanstack/react-query';
import type {BankTransactionTotals} from '@tempo/contracts';

import {dashboardQueryKeys} from '@/features/banking/api/aggregate-query-keys';
import {api} from '@/utils/api';

import {HOME_REFRESH_INTERVAL_MS} from './refresh-interval';

/**
 * Spending and income made between two local dates (`YYYY-MM-DD`), on cash flow's definitions: the totals of
 * every transaction in the range, as the transaction list shows them.
 */
export const useGetBankTransactionTotals = (
  from: string,
  to: string,
  {enabled = true}: {enabled?: boolean} = {},
) => {
  const {data, isError, error, refetch} = useQuery<BankTransactionTotals>({
    queryKey: dashboardQueryKeys.totals(from, to),
    queryFn: () => {
      const params = new URLSearchParams({
        'filter[date][from]': from,
        'filter[date][to]': to,
      });
      return api.get<BankTransactionTotals>(`/bank-transactions/totals?${params.toString()}`);
    },
    enabled,
    refetchInterval: HOME_REFRESH_INTERVAL_MS,
    staleTime: HOME_REFRESH_INTERVAL_MS,
    refetchOnReconnect: 'always',
  });

  return {totals: data, isError, error, refetch};
};
