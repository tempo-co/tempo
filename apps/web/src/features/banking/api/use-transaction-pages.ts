import {type QueryKey, useInfiniteQuery} from '@tanstack/react-query';
import type {BankTransactionsResponse} from '@tempo/contracts';

import {api} from '@/utils/api';

/** Transactions per "Load more"; one of the page sizes the API accepts. */
const PAGE_SIZE = 20;

/**
 * The transactions matching `filters` (`filter[...]` query parameters), newest first, a page at a time, under
 * the caller's own key. `refetchInterval` refreshes only the first page; once more are loaded the list stays put
 * until something invalidates it.
 */
export const useTransactionPages = (
  queryKey: QueryKey,
  filters: Record<string, string>,
  {refetchInterval, staleTime}: {refetchInterval?: number; staleTime?: number} = {},
) =>
  // Each caller's key already names what its filters select.
  // eslint-disable-next-line @tanstack/query/exhaustive-deps
  useInfiniteQuery({
    queryKey,
    queryFn: ({pageParam}) =>
      api.get<BankTransactionsResponse>(
        `/bank-transactions?${new URLSearchParams({
          'pagination[pageIndex]': String(pageParam),
          'pagination[pageSize]': String(PAGE_SIZE),
          ...filters,
        })}`,
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) =>
      pages.length * PAGE_SIZE < lastPage.total && lastPage.transactions.length > 0
        ? pages.length
        : undefined,
    // A refresh refetches every loaded page in turn, so only a list still on its first page polls.
    refetchInterval:
      refetchInterval === undefined
        ? undefined
        : (query) => ((query.state.data?.pages.length ?? 1) > 1 ? false : refetchInterval),
    staleTime,
    refetchOnReconnect: 'always',
  });
