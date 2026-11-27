import {
  type BankBalanceTrend,
  type BankTransactionBreakdownPeriod,
  type BankTransactionCashFlow,
  MAX_RANGE_PERIODS,
} from '@wisp/contracts';
import {getDaysInMonth} from 'date-fns';

import {parseCalendarDate} from './drill-links';
import {BOLD_FIGURE_CHAR, figureColumnWidth} from './format';
import {formatWholeMoney, toCents} from './money';

/** Whole years the history is read for by month and by year: as many as both of the API's range limits allow. */
const HISTORY_YEARS = Math.min(MAX_RANGE_PERIODS.year, Math.floor(MAX_RANGE_PERIODS.month / 12));

/** The first day of the history, so the whole of it fits in one request by month or by year. */
export function historyFrom(today: string) {
  return `${Number(today.slice(0, 4)) - HISTORY_YEARS + 1}-01-01`;
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
};

export type YearRow = {
  year: string;
  complete: boolean;
  /** The balance the year started from: the previous month end; null for the history's first year, as unknown. */
  start: number | null;
  end: number | null;
  income: number;
  spending: number;
  kept: number;
  months: MonthPoint[];
};

export type Overview = {
  today: string;
  currency: string | null;
  months: MonthPoint[];
  years: YearRow[];
  /** Cents; null when today's total could not be converted. */
  total: number | null;
};

/** Month-end balances and monthly flows on one monthly axis, and the same rolled up by year. */
export function buildOverview({
  today,
  trend,
  flow,
}: {
  today: string;
  trend: BankBalanceTrend;
  flow: BankTransactionCashFlow;
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
  });

  return {
    today,
    currency: trend.baseCurrency ?? flow.baseCurrency,
    months,
    years,
    total: months[months.length - 1]?.balance ?? null,
  };
}

/** A point on the balance line: a month end, or a day end over the last month. */
export type BalancePoint = {
  /** The month a click opens, `YYYY-MM`. */
  month: string;
  /** The day the balance is for. */
  end: string;
  complete: boolean;
  /** Cents; null when an account had no exchange rate that day. */
  balance: number | null;
  /** Cents kept in the month; months only. */
  kept?: number;
};

/** The total balance at each day end of a `day` balance trend, oldest first. */
export const dayBalancePoints = (trend: BankBalanceTrend): BalancePoint[] =>
  trend.periods.map((period) => ({
    month: period.end.slice(0, 7),
    end: period.end,
    complete: period.complete,
    balance: period.total === null ? null : toCents(period.total),
  }));

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
  const texts = periods.flatMap((period) => {
    const cover = monthsCovered(period, months);
    if (cover === 0) return [];
    // A part can outgrow the total when refunds make another part negative.
    return [period.total, ...period.parts.map((part) => part.amount)].map((amount) =>
      formatWholeMoney(toCents(amount) / 100 / cover, currency),
    );
  });
  return figureColumnWidth(texts, {perChar: BOLD_FIGURE_CHAR, padding: 1.5, min: 5});
}
