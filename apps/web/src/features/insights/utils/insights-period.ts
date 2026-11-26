import {formatMonth, shiftMonth} from '@/features/dashboard/utils/month';

/** A period in the address: one of the spans, or a calendar year. */
export const PERIOD_PATTERN = /^(month|6m|12m|all|(19|20)\d{2})$/;

/** The period Insights opens on, left out of the address. */
export const DEFAULT_PERIOD = '12m';

const SPANS = [
  {value: 'month', label: 'This month', months: 1},
  {value: '6m', label: '6 months', months: 6},
  {value: '12m', label: '12 months', months: 12},
] as const;

export type PeriodOption = {value: string; label: string};

/** The picker's choices: the spans, each calendar year with history (newest first), then All. */
export function periodOptions(firstMonth: string, thisMonth: string): PeriodOption[] {
  const years: PeriodOption[] = [];
  for (let year = Number(thisMonth.slice(0, 4)); year >= Number(firstMonth.slice(0, 4)); year--)
    years.push({value: String(year), label: String(year)});
  return [...SPANS, ...years, {value: 'all', label: 'All'}];
}

/** The months a period covers, `YYYY-MM` inclusive, cut to the history; a year without history is the default. */
export function periodMonths(period: string | undefined, firstMonth: string, thisMonth: string) {
  const chosen = periodOptions(firstMonth, thisMonth).some((option) => option.value === period)
    ? period!
    : DEFAULT_PERIOD;
  const later = (a: string, b: string) => (a > b ? a : b);
  const span = SPANS.find((option) => option.value === chosen);
  if (span)
    return {
      period: chosen,
      from: later(shiftMonth(thisMonth, 1 - span.months), firstMonth),
      to: thisMonth,
    };
  if (chosen === 'all') return {period: chosen, from: firstMonth, to: thisMonth};
  const to = `${chosen}-12`;
  return {
    period: chosen,
    from: later(`${chosen}-01`, firstMonth),
    to: to < thisMonth ? to : thisMonth,
  };
}

/** "December 2025 – November 2026", or one month's name. */
export function formatPeriodSpan(from: string, to: string) {
  return from === to ? formatMonth(from) : `${formatMonth(from)} – ${formatMonth(to)}`;
}
