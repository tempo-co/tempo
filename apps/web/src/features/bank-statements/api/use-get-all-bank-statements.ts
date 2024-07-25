import {useQuery} from '@tanstack/react-query';
import {toast} from 'sonner';

import {Account} from '@/types/account';
import {BankStatement} from '@/types/bank-statement';
import {api} from '@/utils/api';

export const useGetAllBankStatements = (accountId: Account['id']) => {
  const {
    data: bankStatements,
    isPending,
    isError,
  } = useQuery<BankStatement[]>({
    queryKey: ['bank-statements', accountId],
    queryFn: async () => {
      const response = await api.get(`/accounts/${accountId}/bank-statements`);
      return response.json();
    },
  });

  if (isError) {
    toast.error('There was a problem with your request.', {
      description: 'Your accounts could not be loaded. Please try again.',
    });
  }

  return {bankStatements, isPending};
};
