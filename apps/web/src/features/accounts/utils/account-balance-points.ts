import type {BankBalanceTrend} from '@tempo/contracts';

import type {BalancePoint} from '@/features/dashboard/utils/overview';

/**
 * One account's balance at each period end of `trend`, in the trend's reporting currency and in cents, from its
 * first known balance on. A later period without one (no exchange rate that day) stays as a gap.
 */
export function accountBalancePoints(trend: BankBalanceTrend, accountId: string): BalancePoint[] {
  const points = trend.periods.map((period) => {
    const balance = period.accounts.find(({id}) => id === accountId)?.balance ?? null;
    return {
      month: period.end.slice(0, 7),
      end: period.end,
      complete: period.complete,
      balance: balance === null ? null : Math.round(Number(balance) * 100),
    };
  });
  const first = points.findIndex((point) => point.balance !== null);
  return first === -1 ? [] : points.slice(first);
}
