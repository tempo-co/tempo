import {queryOptions, useQuery} from '@tanstack/react-query';
import {BankConnectionAspsp} from '@tempo/contracts';

import {api} from '@/utils/api';

import {bankQueryKeys} from './query-keys';

export const supportedBanksQueryOptions = queryOptions({
  queryKey: bankQueryKeys.supportedBanks,
  queryFn: async () => {
    return await api.get<BankConnectionAspsp[]>('/bank-connections/aspsps');
  },
  // The provider's bank list rarely changes; Home shows its logos on every visit.
  staleTime: 60 * 60_000,
  retry: false,
});

export const useGetSupportedBanks = (enabled: boolean) => {
  const {
    data: supportedBanks,
    dataUpdatedAt,
    isPending,
    isError,
    refetch,
  } = useQuery({...supportedBanksQueryOptions, enabled});

  return {supportedBanks, dataUpdatedAt, isPending, isError, refetch};
};
