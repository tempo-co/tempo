import {addDays} from 'date-fns';

import {BankStatement} from '@/types/bank-statement';

/**
 * Merges contiguous periods into one continuous block.
 */
export function mergePeriods(bankStatements: BankStatement[]) {
  const periods = bankStatements
    .map((statement) => statement.period)
    .map((period) => ({start: new Date(period.start), end: new Date(period.end)}));
  if (periods.length === 0) return [];

  periods.sort((a, b) => a.start.getTime() - b.start.getTime());

  const merged: BankStatement['period'][] = [periods[0]];

  periods.forEach((currentPeriod) => {
    const last = merged[merged.length - 1];

    // If current period is contiguous or overlaps with the last merged period
    if (currentPeriod.start.getTime() <= addDays(last.end, 1).getTime()) {
      last.end = new Date(Math.max(last.end.getTime(), currentPeriod.end.getTime()));
    } else {
      merged.push(currentPeriod);
    }
  });

  return merged;
}

/**
 * Returns modifier functions for Calendar to style days based on bank statement periods.
 */
export function getModifiers(mergedPeriods: BankStatement['period'][]) {
  const periodSet = new Set(mergedPeriods.map((period) => period.start.getTime()));
  const endSet = new Set(mergedPeriods.map((period) => period.end.getTime()));

  return {
    bankStatement: (date: Date) =>
      mergedPeriods.some((period) => date >= period.start && date <= period.end),
    bankStatementStart: (date: Date) => periodSet.has(date.getTime()),
    bankStatementEnd: (date: Date) => endSet.has(date.getTime()),
    bankStatementMonday: (date: Date) =>
      date.getDay() === 1 &&
      mergedPeriods.some((period) => date >= period.start && date <= period.end),
    bankStatementSunday: (date: Date) =>
      date.getDay() === 0 &&
      mergedPeriods.some((period) => date >= period.start && date <= period.end),
  };
}

/**
 * CSS class names for the modifiers.
 */
export const modifiersClassNames = {
  bankStatement: 'bg-success-foreground text-success rounded-none',
  bankStatementStart: 'rounded-l-md',
  bankStatementEnd: 'rounded-r-md',
  bankStatementMonday: 'rounded-l-md',
  bankStatementSunday: 'rounded-r-md',
};
