import {useQuery} from '@tanstack/react-query';
import {toast} from 'sonner';

import {Account} from '@/types/account';
import {api} from '@/utils/api';

export const useGetAllAccounts = () => {
  const {
    data: accounts,
    isPending,
    isError,
  } = useQuery<Account[]>({
    queryKey: ['accounts'],
    queryFn: async () => {
      const response = await api.get('/accounts');
      return response.json();
    },
  });

  if (isError) {
    toast.error('There was a problem with your request.', {
      description: 'Your accounts could not be loaded. Please try again.',
    });
  }
  return {accounts, isPending};
};
