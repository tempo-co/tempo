import type {DataCoverage} from '@tempo/contracts';
import {addDays, format} from 'date-fns';

import {parseCalendarDate} from '@/features/dashboard/utils/drill-links';

/** How many of the accounts a day's data covers: every one, some, or none. */
export type CoverageState = 'all' | 'some' | 'none';

export type CoverageDay = {date: string; state: CoverageState};

/** Each day of the coverage window, oldest first, with how many of the accounts cover it. */
export function coverageDays({from, to, accounts}: DataCoverage): CoverageDay[] {
  const days: CoverageDay[] = [];
  for (let day = parseCalendarDate(from); ; day = addDays(day, 1)) {
    const date = format(day, 'yyyy-MM-dd');
    if (date > to) break;
    const covering = accounts.filter((account) =>
      account.ranges.some((range) => range.from <= date && date <= range.to),
    ).length;
    days.push({
      date,
      state: covering === 0 ? 'none' : covering === accounts.length ? 'all' : 'some',
    });
  }
  return days;
}
