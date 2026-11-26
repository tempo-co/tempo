import {useGetBankTransactionBreakdown} from '@/features/dashboard/api/use-get-bank-transaction-breakdown';
import {useOverview} from '@/features/dashboard/api/use-overview';
import {historyFrom} from '@/features/dashboard/utils/overview';
import {useFiguresCurrencyAccepted} from '@/features/reporting-currency/api/use-reporting-currency';

/**
 * The whole history Insights cuts each period from, as of the local date `today`: balances and cash flow by month
 * ({@link useOverview}), and spending by category and income by source by month. Read once, so switching the period
 * asks for nothing new.
 */
export function useInsightsHistory(today: string) {
  const history = useOverview(today);
  const from = historyFrom(today);
  const categories = useGetBankTransactionBreakdown('month', 'category', from, today, today);
  const sources = useGetBankTransactionBreakdown('month', 'source', from, today, today);
  const accepted = useFiguresCurrencyAccepted();
  const currency = history.overview?.currency;
  // Breakdowns read on the other side of a currency change than the history wait for their refetch.
  const breakdowns =
    history.overview &&
    categories.breakdown &&
    sources.breakdown &&
    categories.breakdown.baseCurrency === currency &&
    sources.breakdown.baseCurrency === currency &&
    (history.overview.months.length === 0 || accepted(currency))
      ? {categories: categories.breakdown.periods, sources: sources.breakdown.periods}
      : null;
  const failed = [categories, sources].filter((query) => query.isError);
  return {
    ...history,
    breakdowns,
    breakdownsError: !breakdowns && failed.length > 0 ? failed[0].error : undefined,
    refetchBreakdowns: () => Promise.all(failed.map((query) => query.refetch())),
  };
}
