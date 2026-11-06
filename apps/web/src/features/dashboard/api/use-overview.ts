import {useMemo} from 'react';

import {buildOverview, historyFrom} from '../utils/overview';
import {useGetBankBalanceTrend} from './use-get-bank-balance-trend';
import {useGetBankTransactionBreakdown} from './use-get-bank-transaction-breakdown';
import {useGetBankTransactionCashFlow} from './use-get-bank-transaction-cash-flow';

/** Home's whole history as of the local date `today`: monthly balances and flows, by month and year. */
export function useOverview(today: string) {
  const from = historyFrom(today);
  const trend = useGetBankBalanceTrend('month', from, today, today);
  const flow = useGetBankTransactionCashFlow('month', from, today, today);

  const overview = useMemo(
    () =>
      trend.balanceTrend && flow.cashFlow
        ? buildOverview({today, trend: trend.balanceTrend, flow: flow.cashFlow})
        : null,
    [today, trend.balanceTrend, flow.cashFlow],
  );
  return {overview, ...settled([trend, flow], overview)};
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
