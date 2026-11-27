/**
 * Pure spending-pace math: a month's spending added up day by day, against earlier months added up the same way. The
 * month summary compares with the months before it; Home's usual pace with the complete months before this one. Money
 * is integer cents (`bigint`) throughout and leaves through `formatCents`.
 */
import {
	type BaselineDay,
	type BaselineTotal,
	MIN_USUAL_PACE_MONTHS,
	type SpendingPaceDay,
	USUAL_PACE_MONTHS,
	type UsualPace,
} from '@tempo/contracts';

import {averageCents, daysInMonth, formatCents, previousMonths} from './bank-transaction-summary';

/** Spending of one calendar month, keyed by day of month. */
export type DailyCents = ReadonlyMap<number, bigint>;

export type SpendingPaceInput = {
	daysInMonth: number;
	/** Last day of the viewed month that counts. */
	throughDay: number;
	daily: DailyCents;
	/** Earlier months to compare with, each with its own length so shorter months stop at their last day. */
	baseline: ReadonlyArray<{days: number; daily: DailyCents}>;
};

export function buildSpendingPace(input: SpendingPaceInput): {daily: SpendingPaceDay[]; baseline: BaselineDay[]} {
	let cumulative = 0n;
	const daily = days(input.throughDay).map((day) => {
		const spending = input.daily.get(day) ?? 0n;
		cumulative += spending;
		return {day, spending: formatCents(spending), cumulative: formatCents(cumulative)};
	});

	if (input.baseline.length === 0) return {daily, baseline: []};
	const cumulativeByMonth = input.baseline.map((month) => cumulativeSeries(month.daily, month.days));
	const baseline = days(input.daysInMonth).map((day) => {
		const totals = cumulativeByMonth.map((series) => series[Math.min(day, series.length) - 1]);
		return {day, ...summarizeBaseline(totals)};
	});
	return {daily, baseline};
}

/** Average and observed low-high band; callers supply at least one baseline month. */
export function summarizeBaseline(totals: readonly bigint[]): BaselineTotal {
	const hasBand = totals.length > 1;
	return {
		average: formatCents(averageCents(totals)),
		low: hasBand ? formatCents(totals.reduce((min, value) => (value < min ? value : min))) : null,
		high: hasBand ? formatCents(totals.reduce((max, value) => (value > max ? value : max))) : null,
	};
}

/**
 * The complete months the usual pace of `month` averages: the newest `USUAL_PACE_MONTHS` before it that history covers
 * from their first day (`firstTransactionDate` on or before it), oldest first.
 */
export function usualPaceMonths(month: string, firstTransactionDate: string | null): string[] {
	if (!firstTransactionDate) return [];
	return previousMonths(month, USUAL_PACE_MONTHS).filter((earlier) => `${earlier}-01` >= firstTransactionDate);
}

export type HomePaceInput = {
	/** `YYYY-MM`: this month. */
	month: string;
	/** The newest day the owner's data covers, not after this month; null without any. */
	lastCoveredDay: string | null;
	/** Where the owner's history starts. */
	firstTransactionDate: string | null;
	/** Spending by month (`YYYY-MM`) and day; days after the last covered day are ignored. */
	spending: ReadonlyMap<string, DailyCents>;
};

/**
 * This month's spending day by day through the last covered day, and the usual pace: the average of the complete
 * months before it, each added up through the same day of the month. No usual pace while fewer than
 * `MIN_USUAL_PACE_MONTHS` complete months exist.
 */
export function buildHomePace({month, lastCoveredDay, firstTransactionDate, spending}: HomePaceInput): {
	daily: SpendingPaceDay[];
	usual: UsualPace | null;
} {
	const monthDays = daysInMonth(month);
	// A last covered day before this month leaves none of it covered.
	const throughDay = lastCoveredDay?.startsWith(month) ? Number(lastCoveredDay.slice(8)) : 0;
	const months = usualPaceMonths(month, firstTransactionDate);
	const pace = buildSpendingPace({
		daysInMonth: monthDays,
		throughDay,
		daily: spending.get(month) ?? new Map(),
		baseline:
			months.length < MIN_USUAL_PACE_MONTHS
				? []
				: months.map((earlier) => ({days: daysInMonth(earlier), daily: spending.get(earlier) ?? new Map()})),
	});
	if (pace.baseline.length === 0) return {daily: pace.daily, usual: null};
	return {
		daily: pace.daily,
		usual: {
			months,
			daily: pace.baseline,
			byLastCoveredDay: throughDay === 0 ? formatCents(0n) : pace.baseline[throughDay - 1].average,
			month: pace.baseline[monthDays - 1].average,
		},
	};
}

function cumulativeSeries(daily: DailyCents, monthDays: number): bigint[] {
	let total = 0n;
	return days(monthDays).map((day) => (total += daily.get(day) ?? 0n));
}

function days(count: number): number[] {
	return Array.from({length: count}, (_, index) => index + 1);
}
