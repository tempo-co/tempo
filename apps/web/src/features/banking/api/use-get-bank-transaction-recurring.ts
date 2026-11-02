import {useQuery} from '@tanstack/react-query';
import type {BankTransactionRecurring} from '@tempo/contracts';

import {api} from '@/utils/api';

import {recurringQueryKeys} from './recurring-query-keys';

/** Exact recurring membership of one owned transaction, judged on the client's local day. */
export function useGetBankTransactionRecurring(id: string, asOf: string) {
  return useQuery({
    queryKey: [...recurringQueryKeys.root, 'transaction', id, asOf],
    queryFn: () =>
      api.get<BankTransactionRecurring | null>(
        `/bank-transactions/${id}/recurring?${new URLSearchParams({asOf})}`,
      ),
    refetchOnReconnect: 'always',
    retry: false,
  });
}
