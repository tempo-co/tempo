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

export type BookingDateRange = {from: Date; to: Date};

export type BookingDatePreset = {
  label: string;
  getRange: (today: Date) => BookingDateRange;
};

// Ranges use midnight dates, matching what the calendar produces for a picked day.
export const BOOKING_DATE_PRESETS: BookingDatePreset[] = [
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

/** How many years back the booking date calendar's year dropdown reaches. */
export const BOOKING_DATE_HISTORY_YEARS = 10;
