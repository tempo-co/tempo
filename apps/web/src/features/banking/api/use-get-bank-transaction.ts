import {useQuery} from '@tanstack/react-query';

import {api} from '@/utils/api';

import {BankTransaction} from '../types/bank-transaction';

export const useGetBankTransaction = (id: BankTransaction['id']) => {
  const {data: transaction, isPending} = useQuery<BankTransaction>({
    queryKey: ['bank-transaction', id],
    queryFn: async () => {
      return await api.get<BankTransaction>(`/bank-transactions/${id}`);
    },
  });

  return {transaction, isPending};
};
