import {useQuery} from '@tanstack/react-query';
import type {BankTransactionCashFlow, CashFlowInterval} from '@tempo/contracts';

import {dashboardQueryKeys} from '@/features/banking/api/aggregate-query-keys';
import {api} from '@/utils/api';

import {HOME_REFRESH_INTERVAL_MS} from './refresh-interval';

/** Spending and income per week, month or year between two local dates (`YYYY-MM-DD`), as of today. */
export const useGetBankTransactionCashFlow = (
  interval: CashFlowInterval,
  from: string,
  to: string,
  asOf: string,
) => {
  const {data, isPending, isError, refetch} = useQuery<BankTransactionCashFlow>({
    queryKey: dashboardQueryKeys.cashFlow(interval, from, to, asOf),
    queryFn: () => {
      const params = new URLSearchParams({interval, from, to, asOf});
      return api.get<BankTransactionCashFlow>(`/bank-transactions/cash-flow?${params.toString()}`);
    },
    placeholderData: (previous) => (previous?.interval === interval ? previous : undefined),
    refetchInterval: HOME_REFRESH_INTERVAL_MS,
    staleTime: HOME_REFRESH_INTERVAL_MS,
    refetchOnReconnect: 'always',
  });

  return {cashFlow: data, isPending, isError, refetch};
};
