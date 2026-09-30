import {useQuery} from '@tanstack/react-query';

import {BankConnectionTransactionsResponse} from '@/features/banking/types/bank-connection';
import {api} from '@/utils/api';

import {bankQueryKeys} from './query-keys';

export const useGetBankConnectionTransactions = (
  connectionId: string,
  enabled: boolean,
  syncVersion: string | null = null,
) => {
  const {data, isPending, isError, refetch} = useQuery<BankConnectionTransactionsResponse>({
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
    transactions: data?.transactions ?? [],
    total: data?.total ?? 0,
    isPending,
    isError,
    refetch,
  };
};
