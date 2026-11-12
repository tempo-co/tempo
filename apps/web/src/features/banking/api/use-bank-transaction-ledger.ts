import {keepPreviousData, useQuery} from '@tanstack/react-query';
import type {BankTransactionTotals} from '@tempo/contracts';
import {useMemo} from 'react';

import {api} from '@/utils/api';

import {
  BANK_TRANSACTION_FILTER_KEYS,
  type BankTransactionFilterParams,
  type BankTransactionSearchParams,
  DEFAULT_BANK_TRANSACTION_SORT,
} from '../types/bank-transaction';
import {countActiveFilters} from '../utils/drill-filters';
import {dashboardQueryKeys} from './aggregate-query-keys';
import {appendBankTransactionFilterParams} from './bank-transaction-filter-params';
import {bankQueryKeys} from './query-keys';
import {useTransactionPages} from './use-transaction-pages';

/** Transactions per "Load more" on the Transactions page. */
const LEDGER_PAGE_SIZE = 50;

/** The Transactions page's rows, 50 at a time, and, with a filter in force, the totals of every row it matches. */
export function useBankTransactionLedger(searchParams: BankTransactionSearchParams) {
  // Query keys compare by value, so a fresh object each render selects the same cached pages.
  const filters = Object.fromEntries(
    BANK_TRANSACTION_FILTER_KEYS.map((key) => [key, searchParams[key]]),
  ) as BankTransactionFilterParams;
  const sort = searchParams.sort ?? DEFAULT_BANK_TRANSACTION_SORT;
  const isFiltered = countActiveFilters(filters) > 0 || Boolean(filters.search?.trim());
  const listParams = appendBankTransactionFilterParams(new URLSearchParams(), filters);
  listParams.set('sort[by]', sort.by);
  listParams.set('sort[order]', sort.order);

  const pages = useTransactionPages(bankQueryKeys.transactions(filters, sort), listParams, {
    pageSize: LEDGER_PAGE_SIZE,
    keepPrevious: true,
  });

  const totals = useQuery({
    queryKey: dashboardQueryKeys.listTotals(filters),
    queryFn: () =>
      api.get<BankTransactionTotals>(
        `/bank-transactions/totals?${appendBankTransactionFilterParams(new URLSearchParams(), filters)}`,
      ),
    placeholderData: keepPreviousData,
    // Without a filter the summary is the count alone.
    enabled: isFiltered,
  });

  const transactions = useMemo(
    () => pages.data?.pages.flatMap((page) => page.transactions) ?? [],
    [pages.data],
  );

  return {
    pages,
    transactions,
    total: pages.data?.pages[0]?.total ?? 0,
    totals: isFiltered ? totals.data : undefined,
    /** The totals still belong to the previous filters, or have not arrived, while the new ones load. */
    totalsPlaceholder: isFiltered && (totals.isPlaceholderData || totals.isPending),
    isFiltered,
    filters,
    sort,
  };
}
