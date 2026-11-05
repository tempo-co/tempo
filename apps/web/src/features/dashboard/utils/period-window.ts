import type {CashFlowInterval} from '@tempo/contracts';
import {format, startOfWeek, subWeeks} from 'date-fns';

import {parseCalendarDate} from './drill-links';
import {currentMonth, localDate, shiftMonth} from './month';

/** How many periods a merchant's chart shows at each zoom level. */
const WEEKS_SHOWN = 26;
const MONTHS_SHOWN = 12;
const YEARS_SHOWN = 10;

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
