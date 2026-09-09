import {useQuery} from '@tanstack/react-query';

import {BankConnection} from '@/features/banking/types/bank-connection';
import {api} from '@/utils/api';

export const useGetAllBankConnections = (enabled = true) => {
  const {
    data: bankConnections,
    isPending,
    isError,
    refetch,
  } = useQuery<BankConnection[]>({
    queryKey: ['bank-connections'],
    queryFn: async () => {
      return await api.get<BankConnection[]>('/bank-connections');
    },
    retry: false,
    enabled,
  });

  return {bankConnections, isPending, isError, refetch};
};
