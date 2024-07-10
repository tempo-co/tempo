import {Account} from '@/types/account';
import {api} from '@/utils/api';
import {useQuery} from '@tanstack/react-query';
import {toast} from 'sonner';

export const useGetAccounts = () => {
  const {
    data: accounts,
    isPending,
    error,
  } = useQuery<Account[]>({
    queryKey: ['accounts'],
    queryFn: async () => {
      const accounts = await api.get('/accounts/me');
      return accounts.json();
    },
  });

  if (error) {
    toast.error('There was a problem with your request.', {
      description: 'Your accounts could not be loaded. Please try again.',
    });
  }
  return {accounts, isPending};
};
