import {useQuery} from '@tanstack/react-query';

import {BankConnectionTransactionsResponse} from '@/features/banking/types/bank-connection';
import {api} from '@/utils/api';
import {savedDataStatus} from '@/utils/query-status';

import {bankQueryKeys} from './query-keys';

export const useGetBankConnectionTransactions = (
  connectionId: string,
  enabled: boolean,
  syncVersion: string | null = null,
) => {
  const query = useQuery<BankConnectionTransactionsResponse>({
    queryKey: bankQueryKeys.connectionTransactions(connectionId, syncVersion),
    queryFn: async () => {
      return await api.get<BankConnectionTransactionsResponse>(
        `/bank-connections/${connectionId}/transactions?limit=5`,
      );
    },
    enabled,
    retry: false,
  });

  return {
    transactions: query.data?.transactions ?? [],
    total: query.data?.total ?? 0,
    ...savedDataStatus(query),
    refetch: query.refetch,
  };
};
