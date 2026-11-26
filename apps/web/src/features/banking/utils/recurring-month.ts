import type {RecurringSeries, RecurringSeriesLists} from '@tempo/contracts';

import {toCents} from '@/features/dashboard/utils/money';

export type MonthGroupId = 'late' | 'coming' | 'paid';

/** One series in one of this month's groups: its payments there added up, and the date the row shows. */
export type MonthEntry = {
  series: RecurringSeries;
  /** Paid: the latest payment. Late and coming up: the first one expected. */
  date: string;
  /** Base-currency cents; null when none of the payments has a base amount yet. */
  cents: number | null;
  /** Payments the entry stands for, more than one at a weekly rhythm. */
  count: number;
};

export type MonthGroup = {
  id: MonthGroupId;
  entries: MonthEntry[];
  /** The bills' cents in the group, as the API adds them into this month's paid and still-due totals. */
  billCents: number;
};

/** A payment placed on the calendar. */
export type CalendarItem = {
  series: RecurringSeries;
  date: string;
  kind: MonthGroupId;
  cents: number | null;
};

const sumCents = (amounts: (string | null)[]) =>
  amounts.some((amount) => amount !== null)
    ? amounts.reduce((sum, amount) => sum + (amount === null ? 0 : toCents(amount)), 0)
    : null;

const counted = ({expenses, income}: RecurringSeriesLists) =>
  [...expenses.series, ...income.series].filter(
    (series): series is RecurringSeries & {thisMonth: NonNullable<RecurringSeries['thisMonth']>} =>
      series.thisMonth !== null,
  );

/**
 * This month's Late, Coming up and Paid groups, bills and income together. A series whose payments fall in more
 * than one group (a weekly bill paid twice with two still to come) is in each of them, so the groups' bills add up
 * to the month's paid and still-due figures.
 */
export function monthGroups(lists: RecurringSeriesLists): MonthGroup[] {
  const groups: Record<MonthGroupId, MonthEntry[]> = {late: [], coming: [], paid: []};
  for (const series of counted(lists)) {
    const {paid, due} = series.thisMonth;
    const late = due.filter((payment) => payment.late);
    const coming = due.filter((payment) => !payment.late);
    for (const [id, payments, date] of [
      ['late', late, late[0]?.date],
      ['coming', coming, coming[0]?.date],
      ['paid', paid, paid[paid.length - 1]?.date],
    ] as const) {
      if (payments.length === 0 || !date) continue;
      groups[id].push({
        series,
        date,
        cents: sumCents(payments.map(({amount}) => amount)),
        count: payments.length,
      });
    }
  }
  return (['late', 'coming', 'paid'] as const).map((id) => {
    const entries = groups[id].sort(
      (a, b) => a.date.localeCompare(b.date) || a.series.name.localeCompare(b.series.name),
    );
    return {
      id,
      entries,
      billCents: entries
        .filter(({series}) => series.direction === 'EXPENSE')
        .reduce((sum, {cents}) => sum + (cents ?? 0), 0),
    };
  });
}

/** Every payment paid or expected this month, on its own day; late ones from an earlier month keep their date. */
export function calendarItems(lists: RecurringSeriesLists): CalendarItem[] {
  return counted(lists)
    .flatMap((series) => [
      ...series.thisMonth.paid.map(({date, amount}) => ({
        series,
        date,
        kind: 'paid' as const,
        cents: amount === null ? null : toCents(amount),
      })),
      ...series.thisMonth.due.map(({date, amount, late}) => ({
        series,
        date,
        kind: late ? ('late' as const) : ('coming' as const),
        cents: amount === null ? null : toCents(amount),
      })),
    ])
    .sort((a, b) => a.date.localeCompare(b.date) || a.series.name.localeCompare(b.series.name));
}

/** Counted series with nothing paid or expected this month: a quarterly or yearly bill between payments. */
export function notThisMonth(lists: RecurringSeriesLists): RecurringSeries[] {
  return counted(lists)
    .filter(({thisMonth}) => thisMonth.paid.length === 0 && thisMonth.due.length === 0)
    .sort((a, b) => a.nextExpectedDate.localeCompare(b.nextExpectedDate));
}

/** The flags a row shows, in this order: Late, Pricier, Ended. */
export type SeriesFlag = 'late' | 'pricier' | 'ended';

export function seriesFlags(series: RecurringSeries): SeriesFlag[] {
  const flags: SeriesFlag[] = [];
  if (series.flags.includes('LATE')) flags.push('late');
  if (
    series.flags.includes('HIGHER_THAN_USUAL') ||
    (series.priceChange !== null && Number(series.priceChange.amount) > 0)
  )
    flags.push('pricier');
  if (series.status === 'ENDED') flags.push('ended');
  return flags;
}
