import {useMemo} from 'react';

import {buildOverview, historyFrom} from '../utils/overview';
import {useGetBankBalanceTrend} from './use-get-bank-balance-trend';
import {useGetBankTransactionBreakdown} from './use-get-bank-transaction-breakdown';
import {useGetBankTransactionCashFlow} from './use-get-bank-transaction-cash-flow';

/** Home's whole history as of the local date `today`: monthly balances and flows, yearly breakdowns. */
export function useOverview(today: string) {
  const from = historyFrom(today);
  const trend = useGetBankBalanceTrend('month', from, today, today);
  const flow = useGetBankTransactionCashFlow('month', from, today, today);
  const categories = useGetBankTransactionBreakdown('year', 'category', from, today, today);
  const sources = useGetBankTransactionBreakdown('year', 'source', from, today, today);

  const overview = useMemo(
    () =>
      trend.balanceTrend && flow.cashFlow && categories.breakdown && sources.breakdown
        ? buildOverview({
            today,
            trend: trend.balanceTrend,
            flow: flow.cashFlow,
            categories: categories.breakdown.periods,
            sources: sources.breakdown.periods,
          })
        : null,
    [today, trend.balanceTrend, flow.cashFlow, categories.breakdown, sources.breakdown],
  );
  const queries = [trend, flow, categories, sources];
  return {
    overview,
    isError: !overview && queries.some((query) => query.isError),
    refetch: () =>
      Promise.all(queries.filter((query) => query.isError).map((query) => query.refetch())),
  };
}
