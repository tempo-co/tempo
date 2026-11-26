import type {RecurringSeries, RecurringSeriesLists} from '@tempo/contracts';

import {toCents} from '@/features/dashboard/utils/money';

export type MonthGroupId = 'late' | 'coming' | 'paid';

/** A payment's state in words, as rows and calendar chips name it. */
export const MONTH_KIND_LABELS: Record<MonthGroupId, string> = {
  paid: 'paid',
  late: 'late',
  coming: 'coming up',
};

/** One series in one of this month's groups: its payments there added up, and the date the row shows. */
export type MonthEntry = {
  series: RecurringSeries;
  /** Paid: the latest payment. Late and coming up: the first one expected. Income: the first still due, else the latest. */
  date: string;
  /** Where the row's date stands: paid, late or coming up. */
  kind: MonthGroupId;
  /** Payments already in this month, out of `count`. */
  paidCount: number;
  /** Base-currency cents; null when none of the payments has a base amount yet. */
  cents: number | null;
  /** Payments the entry stands for, more than one at a weekly rhythm. */
  count: number;
};

/** Bills sit in Late, Coming up and Paid; recurring income has a group of its own below them. */
export type MonthGroup = {
  id: MonthGroupId | 'income';
  entries: MonthEntry[];
  /** The group's cents, as the API adds them into this month's paid and still-due totals. */
  cents: number;
};

/** A payment placed on the calendar. */
export type CalendarItem = {
  /** Unique on the calendar, even for two payments of one series on one day. */
  id: string;
  series: RecurringSeries;
  date: string;
  kind: MonthGroupId;
  cents: number | null;
};

const sumCents = (amounts: (string | null)[]) =>
  amounts.some((amount) => amount !== null)
    ? amounts.reduce((sum, amount) => sum + (amount === null ? 0 : toCents(amount)), 0)
    : null;

type CountedSeries = RecurringSeries & {thisMonth: NonNullable<RecurringSeries['thisMonth']>};

const withMonth = (series: RecurringSeries[]) =>
  series.filter((one): one is CountedSeries => one.thisMonth !== null);

const counted = ({expenses, income}: RecurringSeriesLists) =>
  withMonth([...expenses.series, ...income.series]);

const byDate = (a: MonthEntry, b: MonthEntry) =>
  a.date.localeCompare(b.date) || a.series.name.localeCompare(b.series.name);

const group = (id: MonthGroup['id'], entries: MonthEntry[]): MonthGroup => ({
  id,
  entries: entries.sort(byDate),
  cents: entries.reduce((sum, {cents}) => sum + (cents ?? 0), 0),
});

/**
 * This month's Late, Coming up and Paid bills, then an Income group. A bill whose payments fall in more than one
 * group (a weekly bill paid twice with two still to come) is in each of them, so the groups add up to the month's
 * paid and still-due figures. An income series is one row with all of this month's payments.
 */
export function monthGroups(lists: RecurringSeriesLists): MonthGroup[] {
  const bills: Record<MonthGroupId, MonthEntry[]> = {late: [], coming: [], paid: []};
  for (const series of withMonth(lists.expenses.series)) {
    const {paid, due} = series.thisMonth;
    const late = due.filter((payment) => payment.late);
    const coming = due.filter((payment) => !payment.late);
    for (const [id, payments, date] of [
      ['late', late, late[0]?.date],
      ['coming', coming, coming[0]?.date],
      ['paid', paid, paid[paid.length - 1]?.date],
    ] as const) {
      if (payments.length === 0 || !date) continue;
      bills[id].push({
        series,
        date,
        kind: id,
        paidCount: id === 'paid' ? payments.length : 0,
        cents: sumCents(payments.map(({amount}) => amount)),
        count: payments.length,
      });
    }
  }
  const income = withMonth(lists.income.series).flatMap((series): MonthEntry[] => {
    const {paid, due} = series.thisMonth;
    const next = due[0];
    const date = next?.date ?? paid[paid.length - 1]?.date;
    if (!date) return [];
    return [
      {
        series,
        date,
        kind: next ? (next.late ? 'late' : 'coming') : 'paid',
        paidCount: paid.length,
        cents: sumCents([...paid, ...due].map(({amount}) => amount)),
        count: paid.length + due.length,
      },
    ];
  });
  return [
    ...(['late', 'coming', 'paid'] as const).map((id) => group(id, bills[id])),
    group('income', income),
  ];
}

/** Every payment paid or expected this month, on its own day; late ones from an earlier month keep their date. */
export function calendarItems(lists: RecurringSeriesLists): CalendarItem[] {
  return counted(lists)
    .flatMap((series) => [
      ...series.thisMonth.paid.map(({date, amount}, index) => ({
        id: `${series.key}-paid-${index}`,
        series,
        date,
        kind: 'paid' as const,
        cents: amount === null ? null : toCents(amount),
      })),
      ...series.thisMonth.due.map(({date, amount, late}, index) => ({
        id: `${series.key}-due-${index}`,
        series,
        date,
        kind: late ? ('late' as const) : ('coming' as const),
        cents: amount === null ? null : toCents(amount),
      })),
    ])
    .sort((a, b) => a.date.localeCompare(b.date) || a.series.name.localeCompare(b.series.name));
}

/** Rhythms that skip months, so a series can have nothing paid or expected in one. */
const SKIPS_MONTHS: ReadonlySet<RecurringSeries['cadence']> = new Set(['QUARTERLY', 'YEARLY']);

/** Counted quarterly and yearly series with nothing paid or expected this month. */
export function notThisMonth(lists: RecurringSeriesLists): RecurringSeries[] {
  return counted(lists)
    .filter(
      ({cadence, thisMonth}) =>
        SKIPS_MONTHS.has(cadence) && thisMonth.paid.length === 0 && thisMonth.due.length === 0,
    )
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
