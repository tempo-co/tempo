import {addMonths, endOfMonth, format, parse} from 'date-fns';

/** `YYYY-MM`, the month format the summary API and the Home URL use. */
export const MONTH_PATTERN = /^(19|20)\d{2}-(0[1-9]|1[0-2])$/;

function parseMonth(month: string) {
  return parse(month, 'yyyy-MM', new Date());
}

export function currentMonth(now = new Date()) {
  return format(now, 'yyyy-MM');
}

/** The local calendar date the summary cuts the current month at. */
export function localDate(now = new Date()) {
  return format(now, 'yyyy-MM-dd');
}

export function shiftMonth(month: string, months: number) {
  return format(addMonths(parseMonth(month), months), 'yyyy-MM');
}

/** "October 2026". */
export function formatMonth(month: string) {
  return format(parseMonth(month), 'MMMM yyyy');
}

/** "Jul–Sep" for consecutive months, oldest first; one month is just "Sep". */
export function formatMonthRange(months: string[]) {
  const names = months.map((month) => format(parseMonth(month), 'MMM'));
  return names.length > 1 ? `${names[0]}–${names[names.length - 1]}` : (names[0] ?? '');
}

/** First and last calendar dates of the month, as `YYYY-MM-DD`. */
export function monthDates(month: string) {
  return {from: `${month}-01`, to: format(endOfMonth(parseMonth(month)), 'yyyy-MM-dd')};
}
