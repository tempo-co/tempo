import {
  endOfMonth,
  endOfYear,
  startOfDay,
  startOfMonth,
  startOfYear,
  subDays,
  subMonths,
  subYears,
} from 'date-fns';

export type DateFilterRange = {from: Date; to: Date};

export type DateFilterPreset = {
  label: string;
  getRange: (today: Date) => DateFilterRange;
};

// Ranges use midnight dates, matching what the calendar produces for a picked day.
export const DATE_FILTER_PRESETS: DateFilterPreset[] = [
  {label: 'Last 30 days', getRange: (today) => ({from: subDays(today, 29), to: today})},
  {label: 'This month', getRange: (today) => ({from: startOfMonth(today), to: today})},
  {
    label: 'Last month',
    getRange: (today) => {
      const lastMonth = subMonths(today, 1);
      return {from: startOfMonth(lastMonth), to: startOfDay(endOfMonth(lastMonth))};
    },
  },
  {label: 'Last 3 months', getRange: (today) => ({from: subMonths(today, 3), to: today})},
  {label: 'This year', getRange: (today) => ({from: startOfYear(today), to: today})},
  {
    label: 'Last year',
    getRange: (today) => {
      const lastYear = subYears(today, 1);
      return {from: startOfYear(lastYear), to: startOfDay(endOfYear(lastYear))};
    },
  },
];

/** How many years back the date filter calendar's year dropdown reaches. */
export const DATE_FILTER_HISTORY_YEARS = 10;
