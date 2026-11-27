import {keepPreviousData, useInfiniteQuery} from '@tanstack/react-query';
import {
  MERCHANT_LIST_DEFAULT_LIMIT,
  type MerchantGroupsQuery,
  type MerchantGroupsResponse,
} from '@wisp/contracts';

import {api} from '@/utils/api';

import {merchantQueryKeys} from './merchant-query-keys';

/**
 * Every merchant group with rows between two local dates, most spent first, `limit` at a time; `search` narrows by
 * name and `category` counts only that category's rows. Waits while `range` is null.
 */
export const useGetMerchants = (
  search: string,
  range: {from: string; to: string} | null,
  limit = MERCHANT_LIST_DEFAULT_LIMIT,
  category?: MerchantGroupsQuery['category'],
) =>
  useInfiniteQuery({
    enabled: range !== null,
    queryKey: merchantQueryKeys.list(search, range, limit, category),
    queryFn: ({pageParam}) => {
      const params = new URLSearchParams({
        offset: String(pageParam),
        limit: String(limit),
      });
      if (search) params.set('search', search);
      if (category) params.set('category', category);
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
