import {useQuery} from '@tanstack/react-query';
import type {MerchantGroup} from '@tempo/contracts';

import {api} from '@/utils/api';

import {merchantQueryKeys} from './merchant-query-keys';

/** One merchant group's all-time totals and variants. */
export const useGetMerchant = (id: string) => {
  const {data, isPending, isError, error, refetch} = useQuery<MerchantGroup>({
    queryKey: merchantQueryKeys.detail(id),
    queryFn: () => api.get<MerchantGroup>(`/merchants/${encodeURIComponent(id)}`),
    // A merchant with no rows left answers 404; retrying would only delay saying so.
    retry: false,
    refetchOnReconnect: 'always',
  });
  return {merchant: data, isPending, isError, error, refetch};
};
