import {useQuery} from '@tanstack/react-query';

import {BankAccount} from '@/types/bank-account';
import {api} from '@/utils/api';

export const useGetBankAccount = (id: BankAccount['id']) => {
  const {data: bankAccount, isPending} = useQuery<BankAccount>({
    queryKey: ['bank-account', id],
    queryFn: async () => {
      return await api.get<BankAccount>(`/bank-accounts/${id}`);
    },
  });
  return {bankAccount, isPending};
};
