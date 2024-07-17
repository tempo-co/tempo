import {useQuery} from '@tanstack/react-query';
import {toast} from 'sonner';

import {Account} from '@/types/account';
import {api} from '@/utils/api';

export const useGetAccount = (id: Account['id']) => {
  const {
    data: account,
    isPending,
    error,
  } = useQuery<Account>({
    queryKey: [{id}],
    queryFn: async () => {
      const response = await api.get(`/accounts/${id}`);
      return response.json();
    },
  });

  if (error) {
    toast.error('There was a problem with your request.', {
      description: 'Your accounts could not be loaded. Please try again.',
    });
  }
  return {account, isPending};
};
