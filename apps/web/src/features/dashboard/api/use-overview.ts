import {useMemo} from 'react';

import {useFiguresCurrencyAccepted} from '@/features/reporting-currency/api/use-reporting-currency';

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
  const accepted = useFiguresCurrencyAccepted();
  // Only in the reporting currency: responses read on either side of a currency change, or during its conversion,
  // are not shown or added together.
  // An empty history has no figures to mislabel, so it shows as it is (importing, or none yet).
  const shown =
    trend.balanceTrend &&
    flow.cashFlow &&
    trend.balanceTrend.baseCurrency === flow.cashFlow.baseCurrency &&
    ((trend.balanceTrend.periods.length === 0 && flow.cashFlow.periods.length === 0) ||
      accepted(trend.balanceTrend.baseCurrency));

  const overview = useMemo(
    () =>
      shown && trend.balanceTrend && flow.cashFlow
        ? buildOverview({today, trend: trend.balanceTrend, flow: flow.cashFlow})
        : null,
    [shown, today, trend.balanceTrend, flow.cashFlow],
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
  const accepted = useFiguresCurrencyAccepted();
  const shown = accepted(trend.balanceTrend?.baseCurrency) && accepted(totals.totals?.baseCurrency);
  const lastMonth = useMemo(
    () =>
      shown &&
      trend.balanceTrend &&
      totals.totals &&
      trend.balanceTrend.baseCurrency === totals.totals.baseCurrency
        ? {
            ...range,
            currency: trend.balanceTrend.baseCurrency,
            days: dayBalancePoints(trend.balanceTrend),
            income: toCents(totals.totals.income),
            spending: toCents(totals.totals.spending),
          }
        : null,
    [shown, range, trend.balanceTrend, totals.totals],
  );
  return {lastMonth, ...settled([trend, totals], lastMonth)};
}

/** Spending by category and income by source per year, over the same history as {@link useOverview}. */
export function useYearBreakdowns(today: string) {
  const from = historyFrom(today);
  const categories = useGetBankTransactionBreakdown('year', 'category', from, today, today);
  const sources = useGetBankTransactionBreakdown('year', 'source', from, today, today);
  const accepted = useFiguresCurrencyAccepted();
  const breakdowns =
    categories.breakdown &&
    accepted(categories.breakdown.baseCurrency) &&
    sources.breakdown &&
    categories.breakdown.baseCurrency === sources.breakdown.baseCurrency
      ? {
          categories: categories.breakdown.periods,
          sources: sources.breakdown.periods,
          currency: categories.breakdown.baseCurrency,
        }
      : null;
  return {breakdowns, ...settled([categories, sources], breakdowns)};
}

/** Failed while `result` is still missing, the first failure's error, and a refetch of only the queries that failed. */
function settled(
  queries: {isError: boolean; error: unknown; refetch: () => Promise<unknown>}[],
  result: object | null,
) {
  return {
    isError: !result && queries.some((query) => query.isError),
    error: queries.find((query) => query.isError)?.error,
    refetch: () =>
      Promise.all(queries.filter((query) => query.isError).map((query) => query.refetch())),
  };
}
