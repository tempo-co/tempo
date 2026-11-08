import {dashboardQueryKeys} from '@/features/banking/api/aggregate-query-keys';
import {useTransactionPages} from '@/features/banking/api/use-transaction-pages';

import {HOME_REFRESH_INTERVAL_MS} from './refresh-interval';

/** The transactions booked between two local dates, newest first, a page at a time. */
export const useGetMonthTransactions = (from: string, to: string) =>
  useTransactionPages(
    dashboardQueryKeys.monthTransactions(from, to),
    {'filter[bookingDate][from]': from, 'filter[bookingDate][to]': to},
    // Fresh like the rest of Home while the month stays open, so late categorization and logos show up.
    {refetchInterval: HOME_REFRESH_INTERVAL_MS, staleTime: HOME_REFRESH_INTERVAL_MS},
  );
