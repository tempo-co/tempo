import {useQuery} from '@tanstack/react-query';

import {api} from '@/utils/api';

import {BankTransaction} from '../types/bank-transaction';

export const useGetBankTransaction = (id: BankTransaction['id'], enabled = true) => {
  const {
    data: transaction,
    isPending,
    isFetching,
    isError,
    error,
    refetch,
  } = useQuery<BankTransaction>({
    queryKey: ['bank-transaction', id],
    queryFn: async () => {
      return await api.get<BankTransaction>(`/bank-transactions/${id}`);
    },
    enabled: enabled && Boolean(id),
    retry: false,
  });

  return {transaction, isPending, isFetching, isError, error, refetch};
};
