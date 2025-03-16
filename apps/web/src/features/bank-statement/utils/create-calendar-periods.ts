import {addDays} from 'date-fns';

import {BankStatement} from '@/types/bank-statement';

/** Merges adjacent periods into one continuous block. */
export function mergePeriods(bankStatements: BankStatement[]) {
  const periods = bankStatements
    .map((statement) => statement.period)
    .map((period) => ({start: new Date(period.start), end: new Date(period.end)}));
  if (periods.length === 0) return [];

  periods.sort((a, b) => a.start.getTime() - b.start.getTime());

  const mergedPeriods: BankStatement['period'][] = [periods[0]];

  periods.forEach((currentPeriod) => {
    const lastMergedPeriod = mergedPeriods[mergedPeriods.length - 1];

    const isAdjacentOrOverlapping =
      currentPeriod.start.getTime() <= addDays(lastMergedPeriod.end, 1).getTime();

    if (isAdjacentOrOverlapping) {
      lastMergedPeriod.end = new Date(
        Math.max(lastMergedPeriod.end.getTime(), currentPeriod.end.getTime()),
      );
    } else {
      mergedPeriods.push(currentPeriod);
    }
  });

  return mergedPeriods;
}

/** Returns modifier functions for Calendar to style days based on bank statement periods. */
export function getModifiers(mergedPeriods: BankStatement['period'][]) {
  const normalizedPeriods = mergedPeriods.map((period) => ({
    start: normalizeDate(period.start),
    end: normalizeDate(period.end),
  }));

  const periodStartSet = new Set(normalizedPeriods.map((p) => p.start));
  const periodEndSet = new Set(normalizedPeriods.map((p) => p.end));

  return {
    bankStatement: (date: Date) => isInPeriod(date, normalizedPeriods),
    bankStatementStart: (date: Date) => periodStartSet.has(normalizeDate(date)),
    bankStatementEnd: (date: Date) => periodEndSet.has(normalizeDate(date)),
    bankStatementMonday: (date: Date) => date.getDay() === 1 && isInPeriod(date, normalizedPeriods),
    bankStatementSunday: (date: Date) => date.getDay() === 0 && isInPeriod(date, normalizedPeriods),
  };
}

/** Normalize date to midnight and return time value in milliseconds. */
function normalizeDate(date: Date): number {
  const normalized = new Date(date.getTime());
  normalized.setHours(0, 0, 0, 0);
  return normalized.getTime();
}

type NormalizedPeriod = {start: number; end: number};

/** Check if a date falls within any normalized period. */
function isInPeriod(date: Date, normalizedPeriod: NormalizedPeriod[]): boolean {
  const timestamp = normalizeDate(date);
  return normalizedPeriod.some((period) => timestamp >= period.start && timestamp <= period.end);
}
