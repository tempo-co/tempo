import type {RecurringSeries} from '@tempo/contracts';
import {differenceInCalendarDays, format} from 'date-fns';

import {parseCalendarDate} from '@/features/dashboard/utils/drill-links';
import {formatMoney} from '@/features/dashboard/utils/money';

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

/** A calendar rhythm repeats on a day of the month; the others count days. */
const CALENDAR_CADENCES: ReadonlySet<RecurringSeries['cadence']> = new Set([
  'MONTHLY',
  'QUARTERLY',
  'YEARLY',
]);

/** The `day` of the month `monthIndex` months after January `year`, or its last day when shorter. */
function dayInMonth(year: number, monthIndex: number, day: number) {
  const first = new Date(year, monthIndex, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return new Date(first.getFullYear(), first.getMonth(), Math.min(day, last));
}

/**
 * The month a payment pays, as "yyyy-MM". On a calendar rhythm it is the month of the due day nearest the
 * payment, so one taken a few days early or late across a month boundary still pays the month it was due in,
 * as the API counts it; a weekly or four-weekly payment pays the month it was made in.
 */
export function paidMonth(
  date: string,
  series: Pick<RecurringSeries, 'cadence' | 'nextExpectedDate'>,
): string {
  if (!CALENDAR_CADENCES.has(series.cadence)) return date.slice(0, 7);
  const day = Number(series.nextExpectedDate.slice(8, 10));
  const paid = parseCalendarDate(date);
  const nearest = [-1, 0, 1]
    .map((offset) => dayInMonth(paid.getFullYear(), paid.getMonth() + offset, day))
    .reduce((best, candidate) =>
      Math.abs(differenceInCalendarDays(candidate, paid)) <
      Math.abs(differenceInCalendarDays(best, paid))
        ? candidate
        : best,
    );
  return format(nearest, 'yyyy-MM');
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
