import {useQuery} from '@tanstack/react-query';

import {BankAccount} from '@/types/bank-account';
import {api} from '@/utils/api';

export const useGetAllBankAccounts = () => {
  const {data: bankAccounts, isPending} = useQuery<BankAccount[]>({
    queryKey: ['bank-accounts'],
    queryFn: async () => {
      return await api.get<BankAccount[]>('/bank-accounts');
    },
  });

  return {bankAccounts, isPending};
};
