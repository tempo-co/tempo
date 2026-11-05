import type {
  BankBalanceTrend,
  BankTransactionBreakdownPeriod,
  BankTransactionCashFlow,
  BankTransactionEvent,
} from '@tempo/contracts';
import {format, getDaysInMonth, subMonths} from 'date-fns';

import {parseCalendarDate} from './drill-links';
import {formatWholeMoney, toCents} from './money';

/** The API's longest range is 20 years, so the whole history fits in one request from this day. */
export function historyFrom(today: string) {
  return `${Number(today.slice(0, 4)) - 19}-01-01`;
}

export type MonthPoint = {
  /** `YYYY-MM`. */
  month: string;
  /** The day the balance is for: the month's last day, or today while it runs. */
  end: string;
  complete: boolean;
  /** Cents; null when an account had no exchange rate that day. */
  balance: number | null;
  income: number;
  spending: number;
  kept: number;
  events: BankTransactionEvent[];
};

export type YearRow = {
  year: string;
  complete: boolean;
  /** The balance the year started from: the previous month end, or zero before the history. */
  start: number | null;
  end: number | null;
  income: number;
  spending: number;
  kept: number;
  events: BankTransactionEvent[];
  months: MonthPoint[];
};

export type Overview = {
  today: string;
  currency: string | null;
  months: MonthPoint[];
  years: YearRow[];
  categories: BankTransactionBreakdownPeriod[];
  sources: BankTransactionBreakdownPeriod[];
  /** Cents; null when today's total could not be converted. */
  total: number | null;
};

/** Month-end balances, monthly flows and one-offs on one monthly axis, and the same rolled up by year. */
export function buildOverview({
  today,
  trend,
  flow,
  events,
  categories,
  sources,
}: {
  today: string;
  trend: BankBalanceTrend;
  flow: BankTransactionCashFlow;
  events: BankTransactionEvent[];
  categories: BankTransactionBreakdownPeriod[];
  sources: BankTransactionBreakdownPeriod[];
}): Overview {
  const flowByMonth = new Map(flow.periods.map((period) => [period.start.slice(0, 7), period]));
  const months: MonthPoint[] = trend.periods.map((period) => {
    const month = period.start.slice(0, 7);
    const flowPeriod = flowByMonth.get(month);
    const income = flowPeriod ? toCents(flowPeriod.income) : 0;
    const spending = flowPeriod ? toCents(flowPeriod.spending) : 0;
    return {
      month,
      end: period.end,
      complete: period.complete,
      balance: period.total === null ? null : toCents(period.total),
      income,
      spending,
      kept: income - spending,
      events: events.filter((event) => event.date.slice(0, 7) === month),
    };
  });

  const years: YearRow[] = [];
  months.forEach((point, index) => {
    const year = point.month.slice(0, 4);
    let row = years[years.length - 1];
    if (row?.year !== year) {
      const before = months[index - 1];
      row = {
        year,
        complete: false,
        start: before ? before.balance : 0,
        end: null,
        income: 0,
        spending: 0,
        kept: 0,
        events: [],
        months: [],
      };
      years.push(row);
    }
    row.months.push(point);
    row.end = point.balance;
    row.income += point.income;
    row.spending += point.spending;
    row.kept += point.kept;
    row.events.push(...point.events);
    row.complete = point.month.endsWith('-12') && point.complete;
  });

  return {
    today,
    currency: trend.baseCurrency ?? flow.baseCurrency,
    months,
    years,
    categories,
    sources,
    total: months[months.length - 1]?.balance ?? null,
  };
}

export const SPANS = [
  {value: '6m', label: '6M', months: 6},
  {value: '1y', label: '1Y', months: 12},
  {value: '3y', label: '3Y', months: 36},
  {value: 'all', label: 'All', months: Infinity},
] as const;
export type Span = (typeof SPANS)[number]['value'];

/**
 * The months a span shows and the month end its change is measured from: the last month end on or before the same
 * day N months ago (31 Oct for 5 Nov a year back), where the line starts. "All" measures from zero, before the first
 * account had history, and so does a span longer than the history. `change` is null when either balance could not
 * be converted.
 */
export function spanMonths(overview: Overview, span: Span) {
  const count = SPANS.find((option) => option.value === span)!.months;
  const all = overview.months;
  const shownAll = {shown: all, base: null, change: overview.total};
  if (!Number.isFinite(count)) return shownAll;
  const target = format(subMonths(parseCalendarDate(overview.today), count), 'yyyy-MM-dd');
  let index = -1;
  all.forEach((point, at) => {
    if (point.complete && point.end <= target) index = at;
  });
  if (index < 0) return shownAll;
  const base = all[index];
  const change =
    overview.total === null || base.balance === null ? null : overview.total - base.balance;
  return {shown: all.slice(index), base, change};
}

/** A breakdown part's amount in cents, zero when the period has no such part. */
export function partCents(period: BankTransactionBreakdownPeriod, key: string) {
  return toCents(period.parts.find((part) => part.key === key)?.amount ?? '0');
}

/** Months of history inside a period: whole months, and a running one as its share of days so far. */
export function monthsCovered(period: BankTransactionBreakdownPeriod, months: MonthPoint[]) {
  const from = period.start.slice(0, 7);
  const to = period.end.slice(0, 7);
  return months
    .filter((point) => point.month >= from && point.month <= to)
    .reduce((sum, point) => {
      if (point.complete) return sum + 1;
      const end = parseCalendarDate(point.end);
      return sum + end.getDate() / getDaysInMonth(end);
    }, 0);
}

/**
 * The width of a year column, from the longest monthly average either table shows, so large amounts fit and the
 * two tables' years still line up.
 */
export function yearColumnWidth(
  periods: BankTransactionBreakdownPeriod[],
  months: MonthPoint[],
  currency: string | null,
) {
  const longest = Math.max(
    0,
    ...periods.flatMap((period) => {
      const cover = monthsCovered(period, months);
      if (cover === 0) return [];
      // A part can outgrow the total when refunds make another part negative.
      return [period.total, ...period.parts.map((part) => part.amount)].map(
        (amount) => formatWholeMoney(toCents(amount) / 100 / cover, currency).length,
      );
    }),
  );
  return `${Math.max(5, Math.ceil((longest * 0.55 + 1.5) * 4) / 4)}rem`;
}
