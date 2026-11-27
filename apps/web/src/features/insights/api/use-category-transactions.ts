import {dashboardQueryKeys} from '@/features/banking/api/aggregate-query-keys';
import {appendBankTransactionFilterParams} from '@/features/banking/api/bank-transaction-filter-params';
import {useTransactionPages} from '@/features/banking/api/use-transaction-pages';
import type {BankTransactionFilterParams} from '@/features/banking/types/bank-transaction';
import {HOME_REFRESH_INTERVAL_MS} from '@/features/dashboard/api/refresh-interval';

/** The rows `filters` select (a category's spending over a period), newest first, a page at a time. */
export const useCategoryTransactions = (filters: BankTransactionFilterParams) => {
  const params = new URLSearchParams();
  appendBankTransactionFilterParams(params, filters);
  return useTransactionPages(dashboardQueryKeys.categoryTransactions(filters), params, {
    refetchInterval: HOME_REFRESH_INTERVAL_MS,
    staleTime: HOME_REFRESH_INTERVAL_MS,
  });
};
