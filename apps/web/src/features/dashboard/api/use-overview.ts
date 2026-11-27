import {useMemo} from 'react';

import {useFiguresCurrencyAccepted} from '@/features/reporting-currency/api/use-reporting-currency';

import {buildOverview, historyFrom} from '../utils/overview';
import {useGetBankBalanceTrend} from './use-get-bank-balance-trend';
import {useGetBankTransactionCashFlow} from './use-get-bank-transaction-cash-flow';

/**
 * The whole history Insights reads as of the local date `today`: monthly balances and flows, by month and year. Requested
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
