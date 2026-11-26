import type {BankTransactionBreakdownPart, BankTransactionBreakdownPeriod} from '@tempo/contracts';

import {toCents} from '@/features/dashboard/utils/money';
import {shiftMonth} from '@/features/dashboard/utils/month';
import type {MonthPoint, Overview, YearRow} from '@/features/dashboard/utils/overview';

const monthOf = (period: {start: string}) => period.start.slice(0, 7);
const within = (month: string, from: string, to: string) => month >= from && month <= to;

/** The history cut to the months `from` through `to`, rolled up by year again, each year from the balance before it. */
export function sliceOverview(overview: Overview, from: string, to: string): Overview {
  const all = overview.months;
  const months = all.filter((point) => within(point.month, from, to));
  const years: YearRow[] = [];
  for (const point of months) {
    const year = point.month.slice(0, 4);
    let row = years[years.length - 1];
    if (row?.year !== year) {
      const before = all[all.indexOf(point) - 1];
      row = {
        year,
        complete: false,
        start: before ? before.balance : null,
        end: null,
        income: 0,
        spending: 0,
        kept: 0,
        months: [],
      };
      years.push(row);
    }
    row.months.push(point);
    row.end = point.balance;
    row.income += point.income;
    row.spending += point.spending;
    row.kept += point.kept;
    row.complete = point.month.endsWith('-12') && point.complete;
  }
  const last = months[months.length - 1];
  return {...overview, months, years, total: last ? last.balance : null};
}

/** In, out and kept over months, in cents. */
export function flowTotals(months: MonthPoint[]) {
  const income = months.reduce((sum, point) => sum + point.income, 0);
  const spending = months.reduce((sum, point) => sum + point.spending, 0);
  return {income, spending, kept: income - spending};
}

/** Every part of the months `from` through `to` summed by key, largest first; parts that net to zero are left out. */
export function sumParts(
  periods: BankTransactionBreakdownPeriod[],
  from: string,
  to: string,
): BankTransactionBreakdownPart[] {
  const byKey = new Map<string, {part: BankTransactionBreakdownPart; cents: number}>();
  // Oldest first, so a source keeps its latest name and logo.
  for (const period of periods.filter((item) => within(monthOf(item), from, to)))
    for (const part of period.parts) {
      const cents = (byKey.get(part.key)?.cents ?? 0) + toCents(part.amount);
      byKey.set(part.key, {part, cents});
    }
  return [...byKey.values()]
    .filter(({cents}) => cents !== 0)
    .sort((left, right) => right.cents - left.cents)
    .map(({part, cents}) => ({...part, amount: (cents / 100).toFixed(2)}));
}

/**
 * Month periods of `from` through `to` rolled up into one period per calendar year, as the yearly breakdown gives
 * them, so the heat tables cover only the period. A year is complete when all twelve of its months are.
 */
export function yearPeriods(
  periods: BankTransactionBreakdownPeriod[],
  from: string,
  to: string,
): BankTransactionBreakdownPeriod[] {
  const shown = periods.filter((period) => within(monthOf(period), from, to));
  const years = [...new Set(shown.map((period) => period.start.slice(0, 4)))];
  return years.map((year) => {
    const months = shown.filter((period) => period.start.startsWith(year));
    const parts = sumParts(months, `${year}-01`, `${year}-12`);
    const total = months.reduce((sum, period) => sum + toCents(period.total), 0);
    return {
      // From 1 January like the yearly breakdown, so a year the period cuts short says where it starts.
      start: `${year}-01-01`,
      end: months[months.length - 1].end,
      complete: months.length === 12 && months.every((period) => period.complete),
      total: (total / 100).toFixed(2),
      parts,
    };
  });
}

/** How many months a sparkline shows. */
export const SPARK_MONTHS = 12;

export type CategoryRow = {
  category: string;
  /** Cents over the period. */
  total: number;
  /** Cents in a complete month, on average; null without a complete month in the period. */
  perMonth: number | null;
  /** Cents in each of the 12 months to the period's end, oldest first; the running one is marked. */
  spark: {month: string; cents: number; complete: boolean}[];
};

/** Spending by category over the period, largest first, each with its average month and its last 12 months. */
export function categoryRows(
  periods: BankTransactionBreakdownPeriod[],
  from: string,
  to: string,
): CategoryRow[] {
  const complete = periods.filter((period) => within(monthOf(period), from, to) && period.complete);
  const sparkFrom = shiftMonth(to, 1 - SPARK_MONTHS);
  const sparkMonths = Array.from({length: SPARK_MONTHS}, (_, index) =>
    shiftMonth(sparkFrom, index),
  );
  const byMonth = new Map(periods.map((period) => [monthOf(period), period]));
  return sumParts(periods, from, to).map((part) => {
    const cents = (period: BankTransactionBreakdownPeriod | undefined) =>
      toCents(period?.parts.find((item) => item.key === part.key)?.amount ?? '0');
    return {
      category: part.key,
      total: toCents(part.amount),
      perMonth:
        complete.length === 0
          ? null
          : Math.round(complete.reduce((sum, period) => sum + cents(period), 0) / complete.length),
      spark: sparkMonths.map((month) => ({
        month,
        cents: cents(byMonth.get(month)),
        complete: byMonth.get(month)?.complete ?? true,
      })),
    };
  });
}
