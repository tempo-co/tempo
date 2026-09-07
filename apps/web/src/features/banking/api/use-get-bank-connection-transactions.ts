import {useQuery} from '@tanstack/react-query';

import {BankTransactionsResponse} from '@/features/banking/types/bank-connection';
import {api} from '@/utils/api';

export const useGetBankConnectionTransactions = (connectionId: string, enabled: boolean) => {
  const {data, isPending} = useQuery<BankTransactionsResponse>({
    queryKey: ['bank-connection-transactions', connectionId],
    queryFn: async () => {
      return await api.get<BankTransactionsResponse>(
        `/bank-connections/${connectionId}/transactions?limit=5`,
      );
    },
    enabled,
  });

  return {transactions: data?.transactions ?? [], total: data?.total ?? 0, isPending};
};
