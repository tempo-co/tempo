import {differenceInCalendarDays, format} from 'date-fns';

import {parseCalendarDate} from '@/features/dashboard/utils/drill-links';
import {formatMoney} from '@/features/dashboard/utils/money';

import type {RecurringSeries} from '../types/recurring-series';

/** Counted in the totals: active and not hidden. */
export const isCounted = (series: Pick<RecurringSeries, 'hidden' | 'status'>) =>
  !series.hidden && series.status === 'ACTIVE';

/** Hidden or ended: shows its last payment instead of the next one. */
export const isPast = (series: Pick<RecurringSeries, 'hidden' | 'status'>) =>
  series.hidden || series.status === 'ENDED';

/**
 * "€26.00 a month" when the payment amount alone does not say it: a non-monthly rhythm or a
 * foreign currency.
 */
export function formatMonthlyEquivalent(series: RecurringSeries, baseCurrency: string | null) {
  if (series.monthlyEquivalent === null) return null;
  if (series.cadence === 'MONTHLY' && series.currency === baseCurrency) return null;
  return `${formatMoney(series.monthlyEquivalent, baseCurrency)} a month`;
}

/** Whole days from `asOf` to `date`; negative when it has passed. */
function daysUntil(date: string, asOf: string) {
  return differenceInCalendarDays(parseCalendarDate(date), parseCalendarDate(asOf));
}

/** "Today", "Tomorrow", "In 4 days", "12 Nov", or "Due 26 Oct" once it has passed. */
export function formatDue(date: string, asOf: string) {
  const days = daysUntil(date, asOf);
  if (days < 0) return `Due ${format(parseCalendarDate(date), 'd MMM')}`;
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days < 7) return `In ${days} days`;
  return format(parseCalendarDate(date), 'd MMM');
}

export type DueGroup = {id: string; title: string; series: RecurringSeries[]};

/** Active series by when they are next due: late, this week, the rest of this month, later. */
export function groupByDue(series: RecurringSeries[], asOf: string): DueGroup[] {
  const month = asOf.slice(0, 7);
  const monthName = format(parseCalendarDate(asOf), 'MMMM');
  const groups: DueGroup[] = [
    {id: 'late', title: 'Late', series: []},
    {id: 'week', title: 'Next 7 days', series: []},
    {id: 'month', title: `Rest of ${monthName}`, series: []},
    {id: 'later', title: 'Later', series: []},
  ];
  const sorted = [...series].sort((a, b) => a.nextExpectedDate.localeCompare(b.nextExpectedDate));
  for (const entry of sorted) {
    const days = daysUntil(entry.nextExpectedDate, asOf);
    if (entry.flags.includes('LATE') || days < 0) groups[0].series.push(entry);
    else if (days < 7) groups[1].series.push(entry);
    else if (entry.nextExpectedDate.startsWith(month)) groups[2].series.push(entry);
    else groups[3].series.push(entry);
  }
  return groups.filter((group) => group.series.length > 0);
}

/** "today", "tomorrow", "in 21 days", or "2 days late". */
export function formatRelativeDays(date: string, asOf: string) {
  const days = daysUntil(date, asOf);
  if (days < 0) return `${-days} ${days === -1 ? 'day' : 'days'} late`;
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

/** "€11.99", or "≈ €62.40" for a varying amount. */
export function formatAmount(
  series: Pick<RecurringSeries, 'amountKind' | 'typicalAmount' | 'currency'>,
) {
  return `${series.amountKind === 'VARIABLE' ? '≈ ' : ''}${formatMoney(series.typicalAmount, series.currency)}`;
}

/** "+€2.00 since Aug" against the price before the change. */
export function formatPriceChange(
  {amount, since}: {amount: string; since: string},
  currency: string,
) {
  const value = Number(amount);
  return `${value < 0 ? '−' : '+'}${formatMoney(Math.abs(value), currency)} since ${format(parseCalendarDate(since), 'MMM')}`;
}
