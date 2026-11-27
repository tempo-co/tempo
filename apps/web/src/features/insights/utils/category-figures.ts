import type {BankTransactionBreakdownPeriod} from '@tempo/contracts';

import {toCents} from '@/features/dashboard/utils/money';
import {formatMonth} from '@/features/dashboard/utils/month';

/** Monthly bars up to this many months; a longer period is drawn by year, as on Insights. */
const MONTH_BARS = 24;

/** One bar of a category's spending: a month, or a year over a long period. */
export type CategoryBar = {
  unit: 'month' | 'year';
  /** `YYYY-MM`, or `YYYY`. */
  key: string;
  tick: string;
  /** What the bar is, in words: "October 2026". */
  name: string;
  cents: number;
  complete: boolean;
  href: string;
};

/**
 * One category's spending over the months `from` through `to` (`YYYY-MM`): its total, its bars and a usual month, the
 * mean of the period's complete months. The usual is left out while fewer than two months are complete.
 */
export function categoryBars(
  periods: BankTransactionBreakdownPeriod[],
  category: string,
  from: string,
  to: string,
  links: {monthHref: (month: string) => string; yearHref: (year: string) => string},
) {
  const months = periods
    .filter((period) => period.start.slice(0, 7) >= from && period.start.slice(0, 7) <= to)
    .map((period) => ({
      month: period.start.slice(0, 7),
      complete: period.complete,
      cents: toCents(period.parts.find((part) => part.key === category)?.amount ?? '0'),
    }));
  const total = months.reduce((sum, point) => sum + point.cents, 0);
  const complete = months.filter((point) => point.complete);
  const usual =
    complete.length < 2
      ? null
      : Math.round(complete.reduce((sum, point) => sum + point.cents, 0) / complete.length);
  if (months.length <= MONTH_BARS)
    return {
      total,
      usual,
      unit: 'month' as const,
      bars: months.map((point): CategoryBar => ({
        unit: 'month',
        key: point.month,
        tick: formatMonth(point.month, 'MMM'),
        name: formatMonth(point.month),
        cents: point.cents,
        complete: point.complete,
        href: links.monthHref(point.month),
      })),
    };
  const years = new Map<string, {cents: number; months: typeof months}>();
  for (const point of months) {
    const year = point.month.slice(0, 4);
    const row = years.get(year) ?? {cents: 0, months: []};
    row.cents += point.cents;
    row.months.push(point);
    years.set(year, row);
  }
  return {
    total,
    usual,
    unit: 'year' as const,
    bars: [...years.entries()].map(([year, row]): CategoryBar => ({
      unit: 'year',
      key: year,
      tick: year,
      name: year,
      cents: row.cents,
      complete: row.months.length === 12 && row.months.every((point) => point.complete),
      href: links.yearHref(year),
    })),
  };
}
