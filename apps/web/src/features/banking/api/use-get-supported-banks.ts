import {useQuery} from '@tanstack/react-query';

import {api} from '@/utils/api';

import {BankConnectionAspsp} from '../types/bank-connection';
import {bankQueryKeys} from './query-keys';

export const useGetSupportedBanks = (enabled: boolean) => {
  const {
    data: supportedBanks,
    isPending,
    isError,
    refetch,
  } = useQuery<BankConnectionAspsp[]>({
    queryKey: bankQueryKeys.supportedBanks,
    queryFn: async () => {
      return await api.get<BankConnectionAspsp[]>('/bank-connections/aspsps');
    },
    enabled,
    retry: false,
  });

  return {supportedBanks, isPending, isError, refetch};
};
