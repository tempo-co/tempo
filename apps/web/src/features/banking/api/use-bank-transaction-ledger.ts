import {hashKey, keepPreviousData, useQuery} from '@tanstack/react-query';
import type {BankTransactionDayTotals, BankTransactionTotals} from '@tempo/contracts';
import {parseISO} from 'date-fns';
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

/**
 * The Transactions page's rows, 50 at a time, the totals of every row the filters match, and, in date order, the
 * totals of each loaded day.
 */
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
  });

  const transactions = useMemo(
    () => pages.data?.pages.flatMap((page) => page.transactions) ?? [],
    [pages.data],
  );

  // The loaded rows run from one day to another; the day totals cover exactly those days, so each Load more asks once.
  const dates = transactions.flatMap(({date}) => (date ? [date] : [])).sort();
  const span =
    sort.by === 'date' && dates.length > 0 ? {from: dates[0], to: dates[dates.length - 1]} : null;
  const dayTotals = useQuery({
    queryKey: dashboardQueryKeys.dayTotals(filters, span),
    queryFn: () =>
      api.get<BankTransactionDayTotals>(
        `/bank-transactions/day-totals?${appendBankTransactionFilterParams(new URLSearchParams(), {
          ...filters,
          date: {from: parseISO(span!.from), to: parseISO(span!.to)},
        })}`,
      ),
    // Load more keeps the loaded days' totals while the wider span loads; other filters' totals never stand in.
    placeholderData: (previous, previousQuery) =>
      previousQuery && hashKey([previousQuery.queryKey[2]]) === hashKey([filters])
        ? previous
        : undefined,
    enabled: span !== null && !pages.isPlaceholderData,
  });
  const days = useMemo(
    () =>
      dayTotals.data && dayTotals.data.baseCurrency
        ? new Map(
            dayTotals.data.days.map((day) => [
              day.date,
              {...day, currency: dayTotals.data.baseCurrency!},
            ]),
          )
        : undefined,
    [dayTotals.data],
  );

  return {
    pages,
    transactions,
    total: pages.data?.pages[0]?.total ?? 0,
    totals: totals.data,
    /** The totals still belong to the previous filters, or have not arrived, while the new ones load. */
    totalsPlaceholder: totals.isPlaceholderData || totals.isPending,
    /** Each loaded day's totals by its date, in the reporting currency; absent until they arrive or without one. */
    dayTotals: days,
    isFiltered,
    filters,
    sort,
  };
}
