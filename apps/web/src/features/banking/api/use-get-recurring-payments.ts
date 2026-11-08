import {recurringQueryKeys} from './recurring-query-keys';
import {useTransactionPages} from './use-transaction-pages';

/** A series' payments, newest first, a page at a time. Refreshes whenever payments change. */
export const useGetRecurringPayments = (seriesKey: string) =>
  useTransactionPages(recurringQueryKeys.payments(seriesKey), {
    'filter[recurringSeriesKey]': seriesKey,
  });
