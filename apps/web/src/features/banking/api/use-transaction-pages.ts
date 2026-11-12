import {type QueryKey, keepPreviousData, useInfiniteQuery} from '@tanstack/react-query';
import type {BankTransactionsResponse} from '@tempo/contracts';

import {api} from '@/utils/api';

/** Transactions per "Load more" unless the caller picks another of the page sizes the API accepts. */
const PAGE_SIZE = 20;

type TransactionPagesOptions = {
  refetchInterval?: number;
  staleTime?: number;
  pageSize?: number;
  /** Keeps the previous key's rows on screen while a new key's first page loads. */
  keepPrevious?: boolean;
};

/**
 * The transactions matching `filters` (`filter[...]` and optional `sort[...]` query parameters), newest first
 * unless sorted, a page at a time, under the caller's own key. `refetchInterval` refreshes only the first page;
 * once more are loaded the list stays put until something invalidates it.
 */
export const useTransactionPages = (
  queryKey: QueryKey,
  filters: Record<string, string> | URLSearchParams,
  {refetchInterval, staleTime, pageSize = PAGE_SIZE, keepPrevious}: TransactionPagesOptions = {},
) =>
  // Each caller's key already names what its filters select.
  // eslint-disable-next-line @tanstack/query/exhaustive-deps
  useInfiniteQuery({
    queryKey,
    queryFn: ({pageParam}) => {
      const params = new URLSearchParams(filters);
      params.set('pagination[pageIndex]', String(pageParam));
      params.set('pagination[pageSize]', String(pageSize));
      return api.get<BankTransactionsResponse>(`/bank-transactions?${params}`);
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) =>
      pages.length * pageSize < lastPage.total && lastPage.transactions.length > 0
        ? pages.length
        : undefined,
    // A refresh refetches every loaded page in turn, so only a list still on its first page polls.
    refetchInterval:
      refetchInterval === undefined
        ? undefined
        : (query) => ((query.state.data?.pages.length ?? 1) > 1 ? false : refetchInterval),
    staleTime,
    placeholderData: keepPrevious ? keepPreviousData : undefined,
    refetchOnReconnect: 'always',
  });
