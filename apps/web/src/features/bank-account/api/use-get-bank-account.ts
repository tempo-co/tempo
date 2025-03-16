import {useQuery} from '@tanstack/react-query';

import {BankAccount} from '@/types/bank-account';
import {api} from '@/utils/api';

export const useGetBankAccount = (id: BankAccount['id']) => {
  const {data: bankAccount, isPending} = useQuery<BankAccount>({
    queryKey: ['bank-account', id],
    queryFn: async () => {
      const response = await api.get(`/bank-accounts/${id}`);
      return response.json();
    },
  });
  return {bankAccount, isPending};
};
