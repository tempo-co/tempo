import {useInfiniteQuery} from '@tanstack/react-query';
import type {BankTransactionsResponse} from '@tempo/contracts';

import {api} from '@/utils/api';

import {merchantQueryKeys} from './merchant-query-keys';

/** Transactions per "Load more"; one of the page sizes the API accepts. */
const PAGE_SIZE = 20;

/** A merchant group's transactions, newest first, a page at a time. */
export const useGetMerchantTransactions = (id: string) =>
  useInfiniteQuery({
    queryKey: merchantQueryKeys.transactions(id),
    queryFn: ({pageParam}) =>
      api.get<BankTransactionsResponse>(
        `/bank-transactions?${new URLSearchParams({
          'pagination[pageIndex]': String(pageParam),
          'pagination[pageSize]': String(PAGE_SIZE),
          'filter[merchantGroup]': id,
        })}`,
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) =>
      pages.length * PAGE_SIZE < lastPage.total && lastPage.transactions.length > 0
        ? pages.length
        : undefined,
    refetchOnReconnect: 'always',
  });
