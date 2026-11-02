import type {CashFlowInterval, MerchantGroup, MerchantRankingItem} from '@tempo/contracts';

import {formatMoney, toCents} from '@/features/dashboard/utils/money';

const DAY_MS = 86_400_000;

/** How often the owner pays a group, from its payment count and the days between the first and last one. */
export function formatFrequency(
  merchant: Pick<MerchantGroup, 'paymentCount' | 'firstDate' | 'lastDate'>,
) {
  const {paymentCount, firstDate, lastDate} = merchant;
  if (paymentCount < 2 || !firstDate || !lastDate) return null;
  const days = (Date.parse(lastDate) - Date.parse(firstDate)) / DAY_MS;
  const gap = days / (paymentCount - 1);
  if (gap <= 1.5) return 'About daily';
  const per = (length: number, unit: string, once: string) => {
    const times = Math.round(length / gap);
    return times <= 1 ? once : `About ${times}× a ${unit}`;
  };
  if (gap < 10) return per(7, 'week', 'About weekly');
  if (gap < 45) return per(30.44, 'month', 'About monthly');
  return per(365.25, 'year', 'About yearly');
}

/** A ranked group against its usual, worded like the category breakdown's comparison. */
export function formatUsualComparison(
  item: Pick<MerchantRankingItem, 'spent' | 'usual'>,
  currency: string | null,
) {
  if (item.usual === null) return null;
  const usual = toCents(item.usual);
  if (usual <= 0) return 'usually nothing';
  if (usual < 2000) return `usually ${formatMoney(item.usual, currency)}`;
  const difference = toCents(item.spent) - usual;
  if (Math.abs(difference) * 100 < usual * 25) return 'about usual';
  return `${difference > 0 ? '+' : '−'}${Math.round((Math.abs(difference) / usual) * 100)}% vs usual`;
}

export const INTERVAL_NOUNS: Record<CashFlowInterval, string> = {
  week: 'week',
  month: 'month',
  year: 'year',
};

export function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}
