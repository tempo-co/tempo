import {useGetBankBalanceTrend} from '@/features/dashboard/api/use-get-bank-balance-trend';
import {
  type BalancePoint,
  type MonthPoint,
  dayBalancePoints,
} from '@/features/dashboard/utils/overview';
import {useFiguresCurrencyAccepted} from '@/features/reporting-currency/api/use-reporting-currency';

/**
 * The total balance line over a period: its month ends from the history's `months` (null while the history loads),
 * or, for This month, each day end of `range`, read on its own. The day ends must be in the history's
 * `currency`.
 */
export function useBalanceLine({
  months,
  historyPlaceholder,
  range,
  byDay,
  today,
  currency,
}: {
  months: MonthPoint[] | null;
  /** The history is an earlier day's, kept while today's loads; its month ends wait for it. */
  historyPlaceholder: boolean;
  range: {from: string; to: string};
  byDay: boolean;
  today: string;
  currency: string | null;
}) {
  const trend = useGetBankBalanceTrend('day', range.from, range.to, today, {
    enabled: byDay,
  });
  const accepted = useFiguresCurrencyAccepted();
  if (!byDay)
    return {
      unit: 'month' as const,
      points: months && !historyPlaceholder ? withBalanceHistory(months) : null,
      isError: false,
      error: null,
      refetch: trend.refetch,
    };
  const days = trend.balanceTrend;
  // Another range's days (kept while a new month's load after midnight), or days in another currency than the
  // history's, never stand for this period.
  const shown =
    months !== null &&
    !!days &&
    !trend.isPlaceholderData &&
    days.baseCurrency === currency &&
    (days.periods.length === 0 || accepted(days.baseCurrency));
  return {
    unit: 'day' as const,
    points: shown ? withBalanceHistory(dayBalancePoints(days)) : null,
    isError: !shown && trend.isError,
    error: trend.error,
    refetch: trend.refetch,
  };
}

/** No points when none has a balance: no account counted in totals had history then, so it is unknown, not zero. */
const withBalanceHistory = (points: BalancePoint[]) =>
  points.some((point) => point.balance !== null) ? points : [];
