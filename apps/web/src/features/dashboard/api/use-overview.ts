import {useMemo} from 'react';

import {toCents} from '../utils/money';
import {buildOverview, dayBalancePoints, historyFrom, lastMonthRange} from '../utils/overview';
import {useGetBankBalanceTrend} from './use-get-bank-balance-trend';
import {useGetBankTransactionBreakdown} from './use-get-bank-transaction-breakdown';
import {useGetBankTransactionCashFlow} from './use-get-bank-transaction-cash-flow';
import {useGetBankTransactionTotals} from './use-get-bank-transaction-totals';

/**
 * Home's whole history as of the local date `today`: monthly balances and flows, by month and year. Requested
 * only while `enabled`; a disabled caller still reads what is cached.
 */
export function useOverview(today: string, {enabled = true}: {enabled?: boolean} = {}) {
  const from = historyFrom(today);
  const trend = useGetBankBalanceTrend('month', from, today, today, {enabled});
  const flow = useGetBankTransactionCashFlow('month', from, today, today, {enabled});

  const overview = useMemo(
    () =>
      trend.balanceTrend && flow.cashFlow
        ? buildOverview({today, trend: trend.balanceTrend, flow: flow.cashFlow})
        : null,
    [today, trend.balanceTrend, flow.cashFlow],
  );
  return {overview, ...settled([trend, flow], overview)};
}

/**
 * The 1M span as of `today`: day-end balances from 30 days back, and the money in and out after that day.
 * Requested only while `enabled`, since Home opens on a longer span.
 */
export function useLastMonth(today: string, enabled: boolean) {
  const range = useMemo(() => lastMonthRange(today), [today]);
  const trend = useGetBankBalanceTrend('day', range.base, range.to, today, {enabled});
  const totals = useGetBankTransactionTotals(range.from, range.to, {enabled});
  const lastMonth = useMemo(
    () =>
      trend.balanceTrend && totals.totals
        ? {
            ...range,
            days: dayBalancePoints(trend.balanceTrend),
            income: toCents(totals.totals.income),
            spending: toCents(totals.totals.spending),
          }
        : null,
    [range, trend.balanceTrend, totals.totals],
  );
  return {lastMonth, ...settled([trend, totals], lastMonth)};
}

/** Spending by category and income by source per year, over the same history as {@link useOverview}. */
export function useYearBreakdowns(today: string) {
  const from = historyFrom(today);
  const categories = useGetBankTransactionBreakdown('year', 'category', from, today, today);
  const sources = useGetBankTransactionBreakdown('year', 'source', from, today, today);
  const breakdowns =
    categories.breakdown && sources.breakdown
      ? {categories: categories.breakdown.periods, sources: sources.breakdown.periods}
      : null;
  return {breakdowns, ...settled([categories, sources], breakdowns)};
}

/** Failed while `result` is still missing, and a refetch of only the queries that failed. */
function settled(
  queries: {isError: boolean; refetch: () => Promise<unknown>}[],
  result: object | null,
) {
  return {
    isError: !result && queries.some((query) => query.isError),
    refetch: () =>
      Promise.all(queries.filter((query) => query.isError).map((query) => query.refetch())),
  };
}
