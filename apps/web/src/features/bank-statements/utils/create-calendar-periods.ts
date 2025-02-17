import {addDays} from 'date-fns';

import {BankStatement} from '@/types/bank-statement';

/**
 * Merges contiguous periods into one continuous block.
 */
export function mergePeriods(bankStatements: BankStatement[]) {
  const periods = bankStatements
    .map((statement) => statement.period)
    .map((period) => ({start: new Date(period.start), end: new Date(period.end)}));

  const sorted = [...periods].sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: BankStatement['period'][] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i].start.getTime() <= addDays(last.end, 1).getTime()) {
      last.end = new Date(Math.max(last.end.getTime(), sorted[i].end.getTime()));
    } else {
      merged.push(sorted[i]);
    }
  }
  return merged;
}

/**
 * Generates modifier functions for Calendar to style days based on bank statement periods.
 */
export function getModifiers(mergedPeriods: BankStatement['period'][]) {
  return {
    bankStatement: (date: Date) =>
      mergedPeriods.some((period) => date >= period.start && date <= period.end),
    bankStatementStart: (date: Date) =>
      mergedPeriods.some((period) => date.getTime() === period.start.getTime()),
    bankStatementEnd: (date: Date) =>
      mergedPeriods.some((period) => date.getTime() === period.end.getTime()),
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
