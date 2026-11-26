import {keepPreviousData, useInfiniteQuery} from '@tanstack/react-query';
import {
  MERCHANT_LIST_DEFAULT_LIMIT,
  type MerchantGroupsQuery,
  type MerchantGroupsResponse,
} from '@tempo/contracts';

import {api} from '@/utils/api';

import {merchantQueryKeys} from './merchant-query-keys';

/**
 * Every merchant group with rows between two local dates (all time without them), most spent first, `limit` at a
 * time; `search` narrows by name.
 */
export const useGetMerchants = (
  search: string,
  range?: {from: string; to: string},
  limit = MERCHANT_LIST_DEFAULT_LIMIT,
) =>
  useInfiniteQuery({
    queryKey: merchantQueryKeys.list(search, range, limit),
    queryFn: ({pageParam}) => {
      const params = new URLSearchParams({
        offset: String(pageParam),
        limit: String(limit),
      });
      if (search) params.set('search', search);
      if (range) {
        const {from, to} = range satisfies Pick<MerchantGroupsQuery, 'from' | 'to'>;
        params.set('from', from);
        params.set('to', to);
      }
      return api.get<MerchantGroupsResponse>(`/merchants?${params}`);
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((total, page) => total + page.merchants.length, 0);
      return loaded < lastPage.total && lastPage.merchants.length > 0 ? loaded : undefined;
    },
    placeholderData: keepPreviousData,
    refetchOnReconnect: 'always',
  });
