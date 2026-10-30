import {useInfiniteQuery} from '@tanstack/react-query';

import {api} from '@/utils/api';

import type {BankTransactionsResponse} from '../types/bank-transaction';
import {recurringQueryKeys} from './recurring-query-keys';

/** Payments per "Load more"; one of the page sizes the API accepts. */
const PAGE_SIZE = 20;

/** A series' payments, newest first, a page at a time. Refreshes whenever payments change. */
export const useGetRecurringPayments = (seriesKey: string) =>
  useInfiniteQuery({
    queryKey: recurringQueryKeys.payments(seriesKey),
    queryFn: ({pageParam}) =>
      api.get<BankTransactionsResponse>(
        `/bank-transactions?${new URLSearchParams({
          'pagination[pageIndex]': String(pageParam),
          'pagination[pageSize]': String(PAGE_SIZE),
          'filter[recurringSeriesKey]': seriesKey,
        })}`,
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) =>
      pages.length * PAGE_SIZE < lastPage.total && lastPage.transactions.length > 0
        ? pages.length
        : undefined,
    refetchOnReconnect: 'always',
  });
