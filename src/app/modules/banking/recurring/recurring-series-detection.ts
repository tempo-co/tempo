import {createHash} from 'node:crypto';

import {BANK_TRANSACTION_DIRECTIONS, type BankTransactionDirection} from '../bank-transaction-direction';
import {averageCents, formatCents} from '../summary/bank-transaction-summary';

export const RECURRING_CADENCES = ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'] as const;
export type RecurringCadence = (typeof RECURRING_CADENCES)[number];

export const RECURRING_AMOUNT_KINDS = ['FIXED', 'VARIABLE'] as const;
export type RecurringAmountKind = (typeof RECURRING_AMOUNT_KINDS)[number];

export const RECURRING_SERIES_STATUSES = ['ACTIVE', 'ENDED'] as const;
export type RecurringSeriesStatus = (typeof RECURRING_SERIES_STATUSES)[number];

export const RECURRING_SERIES_FLAGS = ['PRICE_INCREASED', 'OVERDUE'] as const;
export type RecurringSeriesFlag = (typeof RECURRING_SERIES_FLAGS)[number];

/** One settled, non-internal payment with a merchant identity; amounts are positive magnitudes in cents. */
export type RecurringCandidate = {
	id: string;
	bankAccountId: string;
	date: string;
	merchantKey: string;
	currency: string;
	amountCents: bigint;
	baseAmountCents: bigint | null;
	name: string;
};

export type DetectedRecurringSeries = {
	key: string;
	merchantKey: string;
	name: string;
	direction: BankTransactionDirection;
	cadence: RecurringCadence;
	amountKind: RecurringAmountKind;
	currency: string;
	typicalAmount: string;
	latestAmount: string;
	/** Base-currency cents per month; null while any row lacks a converted amount. */
	monthlyEquivalent: bigint | null;
	transactionIds: string[];
	firstDate: string;
	lastDate: string;
	nextExpectedDate: string;
	status: RecurringSeriesStatus;
	flags: RecurringSeriesFlag[];
};

type CadenceRule = {
	cadence: RecurringCadence;
	/** Accepted range for the median gap between payments, in days. */
	medianGap: [number, number];
	nominalDays: number;
	/** Days a single payment may drift from its expected date. */
	toleranceDays: number;
	months: number;
	minCount: number;
	/** Variable amounts at a weekly rhythm are mostly groceries, not bills. */
	allowsVariable: boolean;
};

const CADENCE_RULES: readonly CadenceRule[] = [
	{
		cadence: 'WEEKLY',
		medianGap: [5, 9],
		nominalDays: 7,
		toleranceDays: 2,
		months: 0,
		minCount: 3,
		allowsVariable: false,
	},
	{
		cadence: 'MONTHLY',
		medianGap: [28, 33],
		nominalDays: 30.44,
		toleranceDays: 6,
		months: 1,
		minCount: 3,
		allowsVariable: true,
	},
	{
		cadence: 'QUARTERLY',
		medianGap: [85, 97],
		nominalDays: 91.31,
		toleranceDays: 12,
		months: 3,
		minCount: 3,
		allowsVariable: true,
	},
	// Two yearly payments are enough to suggest a series; the owner confirms it.
	{
		cadence: 'YEARLY',
		medianGap: [350, 380],
		nominalDays: 365.25,
		toleranceDays: 20,
		months: 12,
		minCount: 2,
		allowsVariable: true,
	},
];

/** A missed payment or two (gaps of two or three cycles) is a skipped period, not irregularity. */
const MAX_CYCLES_PER_GAP = 3;
const MIN_REGULAR_GAP_SHARE = 0.75;
/** Amounts chain into one fixed series within 15% or 2.00 of the series' latest amount. */
const AMOUNT_TOLERANCE_PERCENT = 15n;
const AMOUNT_TOLERANCE_CENTS = 200n;
/** The latest payment counts as a price increase above 5% and 0.50 over the earlier typical amount. */
const PRICE_INCREASE_PERCENT = 5n;
const PRICE_INCREASE_CENTS = 50n;
/** Other payments to the same payee tolerated inside a yearly series' span. */
const MAX_OTHER_PAYMENTS_IN_YEARLY_SPAN = 3;
const DAY_MS = 86_400_000;

/**
 * Finds recurring payments in one owner's history. Deterministic and side-effect free: the same rows and `today`
 * always give the same series, so the result can be computed on every read.
 */
export function detectRecurringSeries(
	candidates: readonly RecurringCandidate[],
	today: string,
): DetectedRecurringSeries[] {
	const payeeKeyOf = payeeKeys(candidates);
	const partitions = new Map<string, RecurringCandidate[]>();
	for (const candidate of candidates) {
		const payeeKey = payeeKeyOf(candidate.merchantKey);
		// Per account: small payments to a payee from one account must not break a bill's rhythm on another.
		const partitionKey = `${candidate.bankAccountId}\u0000${payeeKey}\u0000${candidate.currency}`;
		const partition = partitions.get(partitionKey);
		if (partition) partition.push({...candidate, merchantKey: payeeKey});
		else partitions.set(partitionKey, [{...candidate, merchantKey: payeeKey}]);
	}

	const series: DetectedRecurringSeries[] = [];
	for (const rows of partitions.values()) {
		rows.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
		const fixed = chainByAmount(rows).flatMap((chain) => {
			const rule = matchCadence(chain);
			if (!rule || (rule.cadence === 'YEARLY' && isBusyPayee(rows, chain))) return [];
			return [buildSeries(chain, rule, 'FIXED', today)];
		});
		// A bill whose amount only held still for a while is one variable series, not a short fixed one.
		const fixedRows = fixed.reduce((count, entry) => count + entry.transactionIds.length, 0);
		const rule = fixedRows / rows.length < MIN_REGULAR_GAP_SHARE ? matchCadence(rows) : null;
		if (rule?.allowsVariable) series.push(buildSeries(rows, rule, 'VARIABLE', today));
		else series.push(...fixed);
	}
	return series;
}

// Older bank exports name a person only in the description ("Transfer to FIRST-MIDDLE LAST"); newer ones send
// their name as the counterparty ("First Last", with accents), so one person arrives under two merchant keys.
const PERSON_TRANSFER_PATTERN = /^(?:transfer to|transfer from)\s+(.+)$/;

/**
 * Maps a merchant key to the payee it is grouped under. A name from a "Transfer to/from" description is a person:
 * accents, case and middle names are ignored, so it matches that person's counterparty name. Other keys stay as they
 * are unless they name such a person, so two merchants are never merged on a shortened name alone.
 */
function payeeKeys(candidates: readonly RecurringCandidate[]): (merchantKey: string) => string {
	const people = new Set<string>();
	for (const {merchantKey} of candidates) {
		const transfer = PERSON_TRANSFER_PATTERN.exec(foldName(merchantKeyName(merchantKey)));
		if (transfer) people.add(firstAndLastName(transfer[1]));
	}
	return (merchantKey) => {
		const name = foldName(merchantKeyName(merchantKey));
		const transfer = PERSON_TRANSFER_PATTERN.exec(name);
		const person = firstAndLastName(transfer ? transfer[1] : name);
		if (!transfer && !people.has(person)) return merchantKey;
		return `${merchantKey.slice(0, merchantKey.indexOf(':'))}:${person}`;
	};
}

function merchantKeyName(merchantKey: string): string {
	return merchantKey.slice(merchantKey.indexOf(':') + 1);
}

function foldName(name: string): string {
	return name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** "alex-sam example" and "alex example" are both "alex example". */
function firstAndLastName(name: string): string {
	const words = name.split(' ');
	if (words.length < 2) return name;
	return `${words[0].split('-')[0]} ${words[words.length - 1]}`;
}

/**
 * Two similar payments a year apart at a payee paid often in between are a coincidence, not a yearly bill.
 */
function isBusyPayee(rows: readonly RecurringCandidate[], chain: readonly RecurringCandidate[]): boolean {
	const first = chain[0].date;
	const last = chain[chain.length - 1].date;
	const inChain = new Set(chain.map(({id}) => id));
	const between = rows.filter(({id, date}) => !inChain.has(id) && date >= first && date <= last).length;
	return between > MAX_OTHER_PAYMENTS_IN_YEARLY_SPAN;
}

/** Splits date-ordered rows into chains of similar amounts; a price step continues its chain. */
function chainByAmount(rows: readonly RecurringCandidate[]): RecurringCandidate[][] {
	const chains: RecurringCandidate[][] = [];
	for (const row of rows) {
		let best: RecurringCandidate[] | null = null;
		let bestDistance = 0n;
		for (const chain of chains) {
			const latest = chain[chain.length - 1].amountCents;
			const distance = abs(row.amountCents - latest);
			if (!withinAmountTolerance(distance, latest)) continue;
			if (!best || distance < bestDistance) {
				best = chain;
				bestDistance = distance;
			}
		}
		if (best) best.push(row);
		else chains.push([row]);
	}
	return chains;
}

function withinAmountTolerance(distance: bigint, reference: bigint): boolean {
	const percentTolerance = (reference * AMOUNT_TOLERANCE_PERCENT) / 100n;
	return distance <= (percentTolerance > AMOUNT_TOLERANCE_CENTS ? percentTolerance : AMOUNT_TOLERANCE_CENTS);
}

function matchCadence(rows: readonly RecurringCandidate[]): CadenceRule | null {
	if (rows.length < 2) return null;
	const days = rows.map((row) => toDayNumber(row.date));
	const gaps = days.slice(1).map((day, index) => day - days[index]);
	const medianGap = medianNumber(gaps);
	const rule = CADENCE_RULES.find(({medianGap: [min, max]}) => medianGap >= min && medianGap <= max);
	if (!rule || rows.length < rule.minCount) return null;

	const regular = gaps.filter((gap) => {
		for (let cycles = 1; cycles <= MAX_CYCLES_PER_GAP; cycles++) {
			if (Math.abs(gap - cycles * rule.nominalDays) <= rule.toleranceDays) return true;
		}
		return false;
	}).length;
	return regular / gaps.length >= MIN_REGULAR_GAP_SHARE ? rule : null;
}

function buildSeries(
	rows: readonly RecurringCandidate[],
	rule: CadenceRule,
	amountKind: RecurringAmountKind,
	today: string,
): DetectedRecurringSeries {
	const first = rows[0];
	const latest = rows[rows.length - 1];
	const amounts = rows.map((row) => row.amountCents);
	const typical = medianCents(amounts);
	const nextExpectedDate = addCycles(rows, rule, 1);
	const endsAfter = addDays(addCycles(rows, rule, 2), rule.toleranceDays);
	const status: RecurringSeriesStatus = today > endsAfter ? 'ENDED' : 'ACTIVE';

	const direction = first.merchantKey.startsWith(`${BANK_TRANSACTION_DIRECTIONS.INCOME}:`)
		? BANK_TRANSACTION_DIRECTIONS.INCOME
		: BANK_TRANSACTION_DIRECTIONS.EXPENSE;

	const flags: RecurringSeriesFlag[] = [];
	// A price only rises on something still being paid.
	if (amountKind === 'FIXED' && direction === 'EXPENSE' && status === 'ACTIVE' && rows.length > 1) {
		const earlier = medianCents(amounts.slice(0, -1));
		const increase = latest.amountCents - earlier;
		if (increase > PRICE_INCREASE_CENTS && increase * 100n > earlier * PRICE_INCREASE_PERCENT) {
			flags.push('PRICE_INCREASED');
		}
	}
	if (status === 'ACTIVE' && today > addDays(nextExpectedDate, rule.toleranceDays)) flags.push('OVERDUE');

	return {
		key: seriesKey(first.merchantKey, first.currency, first.id),
		merchantKey: first.merchantKey,
		name: latest.name,
		direction,
		cadence: rule.cadence,
		amountKind,
		currency: first.currency,
		typicalAmount: formatCents(typical),
		latestAmount: formatCents(latest.amountCents),
		monthlyEquivalent: monthlyEquivalent(rows, rule, amountKind),
		transactionIds: rows.map((row) => row.id),
		firstDate: first.date,
		lastDate: latest.date,
		nextExpectedDate,
		status,
		flags,
	};
}

/** A fixed series costs its current price; a variable one its median. Weekly uses 52 weeks over 12 months. */
function monthlyEquivalent(
	rows: readonly RecurringCandidate[],
	rule: CadenceRule,
	amountKind: RecurringAmountKind,
): bigint | null {
	const baseAmounts = rows.map((row) => row.baseAmountCents);
	if (baseAmounts.some((amount) => amount === null)) return null;
	const perPayment =
		amountKind === 'FIXED' ? baseAmounts[baseAmounts.length - 1]! : medianCents(baseAmounts as bigint[]);
	const [numerator, denominator] = rule.months === 0 ? [52n, 12n] : [1n, BigInt(rule.months)];
	return divideRounded(perPayment * numerator, denominator);
}

/** Stays the same as new payments arrive; decisions follow other changes through their payments. */
export function seriesKey(merchantKey: string, currency: string, firstId: string) {
	return createHash('sha256').update([merchantKey, currency, firstId].join('\u0000')).digest('hex').slice(0, 32);
}

function addCycles(rows: readonly RecurringCandidate[], rule: CadenceRule, cycles: number): string {
	const lastDate = rows[rows.length - 1].date;
	if (rule.months === 0) return addDays(lastDate, rule.nominalDays * cycles);
	// Month-based series keep their usual day of the month, clamped to shorter months.
	const anchorDay = Math.round(medianNumber(rows.map((row) => Number(row.date.slice(8, 10)))));
	const [year, month] = lastDate.split('-').map(Number);
	const target = new Date(Date.UTC(year, month - 1 + rule.months * cycles, 1));
	const lastDayOfMonth = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
	target.setUTCDate(Math.min(anchorDay, lastDayOfMonth));
	return target.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
	return new Date(toDayNumber(date) * DAY_MS + Math.round(days) * DAY_MS).toISOString().slice(0, 10);
}

function toDayNumber(date: string): number {
	return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / DAY_MS;
}

function medianNumber(values: readonly number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function medianCents(values: readonly bigint[]): bigint {
	const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : averageCents([sorted[middle - 1], sorted[middle]]);
}

/** Rounds half away from zero, like Postgres `ROUND`. */
function divideRounded(value: bigint, divisor: bigint): bigint {
	const rounded = (abs(value) * 2n + divisor) / (divisor * 2n);
	return value < 0n ? -rounded : rounded;
}

function abs(value: bigint): bigint {
	return value < 0n ? -value : value;
}
