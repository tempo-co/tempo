import {useInfiniteQuery} from '@tanstack/react-query';
import type {BankTransactionsResponse} from '@tempo/contracts';

import {dashboardQueryKeys} from '@/features/banking/api/aggregate-query-keys';
import {api} from '@/utils/api';

import {HOME_REFRESH_INTERVAL_MS} from './refresh-interval';

/** Transactions per "Load more", as in the Merchants and Recurring dialogs. */
const PAGE_SIZE = 20;

/** The transactions booked between two local dates, newest first, a page at a time. */
export const useGetMonthTransactions = (from: string, to: string) =>
  useInfiniteQuery({
    queryKey: dashboardQueryKeys.monthTransactions(from, to),
    queryFn: ({pageParam}) =>
      api.get<BankTransactionsResponse>(
        `/bank-transactions?${new URLSearchParams({
          'pagination[pageIndex]': String(pageParam),
          'pagination[pageSize]': String(PAGE_SIZE),
          'filter[bookingDate][from]': from,
          'filter[bookingDate][to]': to,
        })}`,
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) =>
      pages.length * PAGE_SIZE < lastPage.total && lastPage.transactions.length > 0
        ? pages.length
        : undefined,
    // Fresh like the rest of Home while the month stays open, so late categorization and logos show up.
    staleTime: HOME_REFRESH_INTERVAL_MS,
    refetchInterval: HOME_REFRESH_INTERVAL_MS,
    refetchOnReconnect: 'always',
  });
