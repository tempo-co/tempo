import {useQuery} from '@tanstack/react-query';

import {BankConnection} from '@/features/banking/types/bank-connection';
import {api} from '@/utils/api';

import {bankQueryKeys} from './query-keys';

export const useGetAllBankConnections = () => {
  const {
    data: bankConnections,
    isPending,
    isError,
    refetch,
  } = useQuery<BankConnection[]>({
    queryKey: bankQueryKeys.connections,
    queryFn: async () => {
      return await api.get<BankConnection[]>('/bank-connections');
    },
    retry: false,
  });

  return {bankConnections, isPending, isError, refetch};
};
