import {keepPreviousData, useInfiniteQuery} from '@tanstack/react-query';
import {MERCHANT_LIST_DEFAULT_LIMIT, type MerchantGroupsResponse} from '@tempo/contracts';

import {api} from '@/utils/api';

import {merchantQueryKeys} from './merchant-query-keys';

/** Every merchant group, most spent first, a page at a time; `search` narrows by name. */
export const useGetMerchants = (search: string) =>
  useInfiniteQuery({
    queryKey: merchantQueryKeys.list(search),
    queryFn: ({pageParam}) => {
      const params = new URLSearchParams({
        offset: String(pageParam),
        limit: String(MERCHANT_LIST_DEFAULT_LIMIT),
      });
      if (search) params.set('search', search);
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
