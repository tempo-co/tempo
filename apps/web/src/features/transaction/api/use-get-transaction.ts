import {useQuery} from '@tanstack/react-query';

import {Transaction} from '@/types/transaction';
import {api} from '@/utils/api';

export const useGetTransaction = (id: Transaction['id']) => {
  const {data: transaction, isPending} = useQuery<Transaction>({
    queryKey: ['transaction', id],
    queryFn: async () => {
      const response = await api.get(`/transactions/${id}`);
      return response.json();
    },
  });

  return {transaction, isPending};
};
