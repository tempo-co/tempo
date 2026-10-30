import type {CashFlowInterval} from '@tempo/contracts';
import {format, startOfWeek, subWeeks} from 'date-fns';

import {parseCalendarDate} from './drill-links';
import {currentMonth, localDate, shiftMonth} from './month';

/** How many periods the Home charts show at each zoom level. */
export const WEEKS_SHOWN = 26;
export const WEEKS_SHOWN_PHONE = 13;
export const MONTHS_SHOWN = 12;
export const YEARS_SHOWN = 10;

/** The dates to load for the latest window of weeks, months or years, up to today. */
export function latestWindow(interval: CashFlowInterval) {
  const today = localDate();
  if (interval === 'week') {
    const thisWeek = startOfWeek(parseCalendarDate(today), {weekStartsOn: 1});
    return {from: format(subWeeks(thisWeek, WEEKS_SHOWN - 1), 'yyyy-MM-dd'), to: today};
  }
  if (interval === 'year')
    return {from: `${Number(today.slice(0, 4)) - (YEARS_SHOWN - 1)}-01-01`, to: today};
  return {from: `${shiftMonth(currentMonth(), -(MONTHS_SHOWN - 1))}-01`, to: today};
}

/** Weeks show fewer on a phone so their labels stay readable. */
export function shownWeeks<T>(periods: T[], isMobile: boolean) {
  return periods.slice(-(isMobile ? WEEKS_SHOWN_PHONE : WEEKS_SHOWN));
}
