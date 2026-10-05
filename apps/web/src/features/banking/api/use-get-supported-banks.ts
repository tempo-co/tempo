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
    // The provider's bank list rarely changes; Home shows its logos on every visit.
    staleTime: 60 * 60_000,
    retry: false,
  });

  return {supportedBanks, isPending, isError, refetch};
};
