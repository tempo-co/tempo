import {useQuery} from '@tanstack/react-query';
import type {CashFlowInterval, MerchantRanking} from '@tempo/contracts';

import {HOME_REFRESH_INTERVAL_MS} from '@/features/dashboard/api/refresh-interval';
import {api} from '@/utils/api';

import {merchantQueryKeys} from './merchant-query-keys';

/** Merchant groups ranked by net spending in the period containing `period`, against their usual. */
export const useGetMerchantRanking = (
  interval: CashFlowInterval,
  period: string,
  asOf: string,
  limit: number,
) => {
  const {data, isPending, isError, refetch} = useQuery<MerchantRanking>({
    queryKey: merchantQueryKeys.ranking(interval, period, asOf, limit),
    queryFn: () =>
      api.get<MerchantRanking>(
        `/merchants/ranking?${new URLSearchParams({interval, period, asOf, limit: String(limit)})}`,
      ),
    placeholderData: (previous) => (previous?.interval === interval ? previous : undefined),
    // Home's other figures refresh on this interval; totals change when conversion finishes too.
    refetchInterval: HOME_REFRESH_INTERVAL_MS,
    staleTime: HOME_REFRESH_INTERVAL_MS,
    refetchOnReconnect: 'always',
  });
  return {ranking: data, isPending, isError, refetch};
};
