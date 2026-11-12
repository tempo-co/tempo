import {useQuery} from '@tanstack/react-query';
import type {
  CashFlowInterval,
  MerchantGroupPeriods,
  MerchantGroupPeriodsQuery,
} from '@tempo/contracts';

import {api} from '@/utils/api';

import {merchantQueryKeys} from './merchant-query-keys';

/** One merchant group's totals per week, month or year between two local dates. */
export const useGetMerchantPeriods = (
  id: string,
  interval: CashFlowInterval,
  from: string,
  to: string,
  asOf: string,
) => {
  const {data, isPending, isError, error, refetch} = useQuery<MerchantGroupPeriods>({
    queryKey: merchantQueryKeys.periods(id, interval, from, to, asOf),
    queryFn: () =>
      api.get<MerchantGroupPeriods>(
        `/merchants/${encodeURIComponent(id)}/periods?${new URLSearchParams({
          interval,
          from,
          to,
          asOf,
        } satisfies MerchantGroupPeriodsQuery)}`,
      ),
    placeholderData: (previous) => (previous?.interval === interval ? previous : undefined),
    refetchOnReconnect: 'always',
  });
  return {periods: data, isPending, isError, error, refetch};
};
