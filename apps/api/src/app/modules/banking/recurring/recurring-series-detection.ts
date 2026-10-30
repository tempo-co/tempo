import {createHash} from 'node:crypto';

import {BANK_TRANSACTION_DIRECTIONS, type BankTransactionDirection} from '../bank-transaction-direction';
import type {BankTransactionCategory} from '../categorization/bank-transaction-category';
import {parseMerchantKey} from '../categorization/bank-transaction-merchant-key';
import {divideRounded, formatCents, medianCents} from '../summary/bank-transaction-summary';

export const RECURRING_CADENCES = ['WEEKLY', 'FOUR_WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'] as const;
export type RecurringCadence = (typeof RECURRING_CADENCES)[number];

export const RECURRING_AMOUNT_KINDS = ['FIXED', 'VARIABLE'] as const;
export type RecurringAmountKind = (typeof RECURRING_AMOUNT_KINDS)[number];

export const RECURRING_SERIES_STATUSES = ['ACTIVE', 'ENDED'] as const;
export type RecurringSeriesStatus = (typeof RECURRING_SERIES_STATUSES)[number];

export const RECURRING_SERIES_FLAGS = ['LATE', 'HIGHER_THAN_USUAL'] as const;
export type RecurringSeriesFlag = (typeof RECURRING_SERIES_FLAGS)[number];

/** One settled, non-internal payment with a merchant identity; amounts are positive magnitudes in cents. */
export type RecurringCandidate = {
	id: string;
	bankAccountId: string;
	date: string;
	merchantKey: string;
	/**
	 * Payee identity inferred from bank evidence when it spans several merchant keys or bank accounts; the stored
	 * transaction merchant key remains unchanged.
	 */
	recurringPayeeKey?: string;
	/** True when the original bank text explicitly names a transfer to or from a person. */
	personTransfer?: boolean;
	/** Valid recipient identifiers retained from bank fields and structured text; never used as a name alias. */
	recipientIbans?: readonly string[];
	/** Set by detection on rows it groups under a payee key: the row's own merchant key. */
	sourceMerchantKey?: string;
	currency: string;
	amountCents: bigint;
	baseAmountCents: bigint | null;
	name: string;
	category: string | null;
};

export type UndatedRecurringSeries = {
	key: string;
	/** The payee the series is grouped under; may differ from the merchant key stored on its transactions. */
	merchantKey: string;
	name: string;
	direction: BankTransactionDirection;
	cadence: RecurringCadence;
	amountKind: RecurringAmountKind;
	currency: string;
	/**
	 * Fixed: the latest payment, or the price before it while the latest payment is a one-off spike. Variable: the
	 * median of the recent payments.
	 */
	typicalAmount: string;
	/** The most recent actual payment, including an isolated amount outside the established price. */
	latestAmount: string;
	/** The shown amount per month: the fixed price, or a variable amount's median. */
	usualMonthlyEquivalent: bigint | null;
	/** One usual payment in the base currency: the fixed price, or a variable amount's median. */
	usualBaseAmount: bigint | null;
	/** A variable monthly bill's cost in the month its latest payment was made: that payment. Null otherwise. */
	paidMonthlyEquivalent: bigint | null;
	/** A variable series' lowest and highest recent payment; null for a fixed price. */
	amountRange: RecurringAmountRange | null;
	/** A variable series' recent payments, oldest first; empty for a fixed price. */
	recentPayments: RecurringPayment[];
	/** A variable bill's latest payment is clearly above every recent one before it. */
	higherThanUsual: boolean;
	transactionIds: string[];
	/** Payments that arrived after the series had stopped: later than their expected date plus the grace days. */
	restartTransactionIds: string[];
	firstDate: string;
	lastDate: string;
	nextExpectedDate: string;
	/** A fixed price's recent change against the price before it, until the new price has been paid three times. */
	priceChange: RecurringPriceChange | null;
	/** The latest payment's category. */
	category: string | null;
};

/** A detected history rendered on one date; never stored as the recognition result. */
export type DetectedRecurringSeries = UndatedRecurringSeries & {
	status: RecurringSeriesStatus;
	flags: RecurringSeriesFlag[];
	/** This month's actual cost for a varying monthly bill, otherwise its usual monthly cost. */
	monthlyEquivalent: bigint | null;
};

export type RecurringAmountRange = {low: string; high: string};

export type RecurringPayment = {date: string; amount: string};

export type RecurringPriceChange = {
	/** Signed difference, e.g. "1.50" or "-3.50". */
	amount: string;
	/** Date of the first payment at the new price. */
	since: string;
};

type CadenceRule = {
	cadence: RecurringCadence;
	/** Accepted range for the median gap between payments, in days. */
	medianGap: [number, number];
	nominalDays: number;
	/** Days a single payment may drift from its expected date. */
	toleranceDays: number;
	months: number;
	/** Payments per calendar month, expressed as an exact ratio. */
	monthlyRatio: readonly [bigint, bigint];
	minCount: number;
	/** Variable amounts at a weekly rhythm are mostly groceries, not bills; `variableAllowed` lets weekly pay vary. */
	allowsVariable: boolean;
};

const CADENCE_RULES: readonly CadenceRule[] = [
	{
		cadence: 'WEEKLY',
		medianGap: [5, 9],
		nominalDays: 7,
		toleranceDays: 2,
		months: 0,
		monthlyRatio: [52n, 12n],
		minCount: 3,
		allowsVariable: false,
	},
	{
		cadence: 'FOUR_WEEKLY',
		medianGap: [25, 31],
		nominalDays: 28,
		toleranceDays: 3,
		months: 0,
		monthlyRatio: [13n, 12n],
		minCount: 4,
		allowsVariable: true,
	},
	{
		cadence: 'MONTHLY',
		medianGap: [28, 33],
		nominalDays: 30.44,
		toleranceDays: 6,
		months: 1,
		monthlyRatio: [1n, 1n],
		minCount: 3,
		allowsVariable: true,
	},
	{
		cadence: 'QUARTERLY',
		medianGap: [85, 97],
		nominalDays: 91.31,
		toleranceDays: 12,
		months: 3,
		monthlyRatio: [1n, 3n],
		minCount: 3,
		allowsVariable: true,
	},
	// Two yearly payments need subscription evidence; other categories need at least three occurrences.
	{
		cadence: 'YEARLY',
		medianGap: [350, 380],
		nominalDays: 365.25,
		toleranceDays: 20,
		months: 12,
		monthlyRatio: [1n, 12n],
		minCount: 2,
		allowsVariable: true,
	},
];

/**
 * Whether a varying amount can still be one recurring series. Transfers between people vary because they settle shared
 * costs, so only a fixed amount (rent, an allowance) recurs. Weekly pay varies with hours worked, so weekly income may
 * vary where weekly bills may not.
 */
function variableAllowed(rule: CadenceRule, rows: readonly RecurringCandidate[], person: boolean): boolean {
	if (person || rows.some(isPersonTransferCategory)) return false;
	return (
		rule.allowsVariable ||
		rows.every(({merchantKey}) => parseMerchantKey(merchantKey).direction === BANK_TRANSACTION_DIRECTIONS.INCOME)
	);
}

/** A missed payment or two (gaps of two or three cycles) is a skipped period, not irregularity. */
const MAX_CYCLES_PER_GAP = 3;
const MIN_REGULAR_GAP_SHARE = 0.75;
/** Amounts chain into one fixed series within 15% or 2.00 of the series' latest amount. */
const AMOUNT_TOLERANCE_PERCENT = 15n;
const AMOUNT_TOLERANCE_CENTS = 200n;
/** Two amounts are different prices above 5% and 0.50 apart. */
const PRICE_CHANGE: Threshold = {percent: 5n, cents: 50n};
/** A price change is shown until the new price has been paid this many times. */
const PRICE_CHANGE_SHOWN_PAYMENTS = 3;
/** A payment over 50% and 5.00 away from the shown price is a one-off until a similar amount follows it. */
const SPIKE: Threshold = {percent: 50n, cents: 500n};
/** A jump that matches one of this many payments before it is an amount already paid, not a one-off. */
const REPEAT_LOOKBACK_PAYMENTS = 3;
/** A variable amount is summarized by this many latest payments: their median, range and history. */
const RECENT_PAYMENTS = 6;
/** A variable bill's latest payment is higher than usual over 10% and 5.00 above every recent payment before it. */
const HIGHER_THAN_USUAL: Threshold = {percent: 10n, cents: 500n};
/** Fewest earlier payments that make a usual range to compare the latest one with. */
const MIN_USUAL_PAYMENTS = 3;
/** Other payments to the same payee tolerated inside a yearly series' span. */
const MAX_OTHER_PAYMENTS_IN_YEARLY_SPAN = 3;
const DAY_MS = 86_400_000;
const SUBSCRIPTIONS = 'SUBSCRIPTIONS' satisfies BankTransactionCategory;
/** A payment may arrive this many days after its expected date; the series shows as late until then, then stops. */
const GRACE_DAYS = 5;
/** Middle payment days further apart than this are two billing days, not one; averaging them would fit neither. */
const MAX_MIDDLE_SPREAD_DAYS = GRACE_DAYS;
/** Categories of money sent to or received from other people. */
const PERSON_TRANSFER_CATEGORIES: ReadonlySet<string> = new Set<BankTransactionCategory>([
	'TRANSFER_OUT',
	'TRANSFER_IN',
]);

/** Status, flags, the price label and monthly cost for an undated detection, as on `today`. */
export function atDate(entry: UndatedRecurringSeries, today: string): DetectedRecurringSeries {
	const status: RecurringSeriesStatus = today > addDays(entry.nextExpectedDate, GRACE_DAYS) ? 'ENDED' : 'ACTIVE';
	const flags: RecurringSeriesFlag[] = [];
	if (status === 'ACTIVE' && today > entry.nextExpectedDate) flags.push('LATE');
	if (status === 'ACTIVE' && entry.higherThanUsual) flags.push('HIGHER_THAN_USUAL');
	const paidThisMonth = entry.paidMonthlyEquivalent !== null && entry.lastDate.slice(0, 7) === today.slice(0, 7);
	return {
		...entry,
		status,
		flags,
		priceChange: status === 'ACTIVE' ? entry.priceChange : null,
		monthlyEquivalent: paidThisMonth ? entry.paidMonthlyEquivalent : entry.usualMonthlyEquivalent,
	};
}

/**
 * The dates an active series is still expected to pay from its next expected date (late or not) through `until`,
 * stepping one cycle at a time.
 */
export function expectedDatesThrough(entry: UndatedRecurringSeries, until: string): string[] {
	const rule = CADENCE_RULES.find(({cadence}) => cadence === entry.cadence)!;
	const dates: string[] = [];
	const anchorDay = Number(entry.nextExpectedDate.slice(8, 10));
	const [year, month] = entry.nextExpectedDate.split('-').map(Number);
	for (let cycles = 0; ; cycles++) {
		const date =
			rule.months > 0
				? anchorDate(year, month - 1 + rule.months * cycles, anchorDay)
				: addDays(entry.nextExpectedDate, rule.nominalDays * cycles);
		if (date > until) return dates;
		dates.push(date);
	}
}

/**
 * Finds recurring payments in one owner's history. Deterministic and side-effect free: the same rows and `today`
 * always give the same series. Results are stored per owner, so a change to these rules must bump
 * `RECURRING_DETECTION_RULES_VERSION` in the recurring series service.
 */
export function detectRecurringSeries(
	candidates: readonly RecurringCandidate[],
	today: string,
): DetectedRecurringSeries[] {
	return detectUndatedRecurringSeries(candidates).map((entry) => atDate(entry, today));
}

/** Recognizes payment histories without applying any read date. */
export function detectUndatedRecurringSeries(candidates: readonly RecurringCandidate[]): UndatedRecurringSeries[] {
	const byId = new Map(candidates.map((row) => [row.id, row]));
	const namingPeriod = createNamingPeriodLookup(byId);
	const personKeys = new Set<string>();
	const partitions = new Map<string, RecurringCandidate[]>();
	for (const candidate of candidates) {
		const payeeKey = candidate.recurringPayeeKey ?? candidate.merchantKey;
		if (candidate.personTransfer) personKeys.add(payeeKey);
		// Per account: small payments to a payee from one account must not break a bill's rhythm on another.
		const partitionKey = `${candidate.bankAccountId}\u0000${payeeKey}\u0000${candidate.currency}`;
		const partition = partitions.get(partitionKey);
		const row = grouped(candidate, payeeKey);
		if (partition) partition.push(row);
		else partitions.set(partitionKey, [row]);
	}

	const series = [...partitions.values()].flatMap((rows) =>
		detectAccountPartition(rows, personKeys.has(rows[0].merchantKey), namingPeriod),
	);
	return reconcileAccountSeries(series, candidates, namingPeriod);
}

/** A candidate grouped under a payee key, keeping its own merchant key for the rename check. */
function grouped(candidate: RecurringCandidate, payeeKey: string): RecurringCandidate {
	return {...candidate, merchantKey: payeeKey, sourceMerchantKey: candidate.merchantKey};
}

/** Recognize a complete current naming period before older fixed coverage can erase its evidence. */
function detectAccountPartition(
	rows: RecurringCandidate[],
	person: boolean,
	namingPeriod: NamingPeriodLookup,
): UndatedRecurringSeries[] {
	const whole = detectPartition(rows, person);
	if (
		!rows[rows.length - 1].recurringPayeeKey ||
		(whole.length === 1 && whole[0].transactionIds.length === rows.length)
	)
		return whole;
	const currentRows = namingPeriod(rows, person);
	if (!currentRows || currentRows.length === rows.length) return whole;
	const currentIds = new Set(currentRows.map(({id}) => id));
	const previous = rows.filter(({id}) => !currentIds.has(id));
	return [...detectAccountPartition(previous, person, namingPeriod), completePartition(currentRows, person)!];
}

function completePartition(rows: readonly RecurringCandidate[], person: boolean): UndatedRecurringSeries | null {
	const detected = recognizePartition([...rows], person);
	if (detected.length !== 1 || detected[0].rows.length !== rows.length) return null;
	const current = detected[0];
	return buildSeries(current.rows, current.rule, current.amountKind);
}

/** The same cadence and price rules are used for account-local detection and recognized-history reconciliation. */
function detectPartition(rows: RecurringCandidate[], person: boolean): UndatedRecurringSeries[] {
	return recognizePartition(rows, person).map(({rows, rule, amountKind}) => buildSeries(rows, rule, amountKind));
}

type RecognizedPartition = {
	rows: RecurringCandidate[];
	rule: CadenceRule;
	amountKind: RecurringAmountKind;
};

/** Qualify billing history before unsupported introductory prices can affect cadence or coverage selection. */
function qualifiedBillingHistory(rows: RecurringCandidate[], person: boolean): RecurringCandidate[] {
	const firstPrice = priceRuns(rows).find((period) => matchCadence(period)?.cadence === 'FOUR_WEEKLY');
	if (!firstPrice) return rows;
	const priceStart = rows.indexOf(firstPrice[0]);
	// Earlier billing can qualify before or at the joining payment without moving the trim boundary.
	const earlierSupported = [priceStart, priceStart + 1].some((end) => {
		const earlier = rows.slice(0, end);
		const earlierRule = matchCadence(earlier);
		return (
			earlierRule &&
			(streamAmountKind(earlier, earlierRule) === 'FIXED' || variableAllowed(earlierRule, earlier, person))
		);
	});
	return earlierSupported ? rows : rows.slice(priceStart);
}

/** Qualification does not need to build forecasts/restart calendars for every chronological prefix. */
function recognizePartition(rows: RecurringCandidate[], person: boolean): RecognizedPartition[] {
	rows.sort(byDateThenId);
	const cadenceOf = (chain: readonly RecurringCandidate[]) => {
		const rule = matchCadence(chain);
		if (rule?.cadence !== 'YEARLY') return rule;
		const coincidence = person || chain.some(isPersonTransferCategory) || isBusyPayee(rows, chain);
		const enoughHistory = chain.length >= 3 || chain.every(({category}) => category === SUBSCRIPTIONS);
		return coincidence || !enoughHistory ? null : rule;
	};
	const chains = chainByAmount(rows);
	const combined = qualifiedBillingHistory(rows, person);
	const combinedRule = cadenceOf(combined);
	const fixed = successivePriceChains(chains, cadenceOf).flatMap((chain): RecognizedPartition[] => {
		chain = qualifiedBillingHistory(chain, person);
		const rule = cadenceOf(chain);
		return rule ? [{rows: chain, rule, amountKind: 'FIXED'}] : [];
	});
	// Isolated payments do not count as sustained price evidence for a genuinely variable bill.
	const fixedRows = chains.filter((chain) => cadenceOf(chain)).reduce((count, chain) => count + chain.length, 0);
	const rule = fixedRows / rows.length < MIN_REGULAR_GAP_SHARE ? combinedRule : null;
	const recognized: RecognizedPartition[] =
		combinedRule && latestPricePeriod(combined, chains, combinedRule)
			? [{rows: combined, rule: combinedRule, amountKind: 'FIXED'}]
			: rule && variableAllowed(rule, combined, person) && !hasRecurringOverlap(combined, rule)
				? [{rows: combined, rule, amountKind: 'VARIABLE'}]
				: fixed;
	// One payer on one rhythm is one stream whatever its amounts; payments outside that rhythm stay out of it.
	// Renamed histories linked by bank evidence are reconciled by their naming periods instead.
	const sources = new Set(rows.map(({sourceMerchantKey}) => sourceMerchantKey));
	const renamed = sources.size > 1 || sources.has(undefined);
	if (renamed && rows.some(({recurringPayeeKey}) => recurringPayeeKey)) return recognized;
	const streams = rhythmStreams(rows, cadenceOf, person);
	if (streams.length === 0) return recognized;
	const covered = (parts: readonly RecognizedPartition[]) =>
		parts.reduce((count, part) => count + part.rows.length, 0);
	if (streams.length > 1) return covered(streams) > covered(recognized) ? streams : recognized;
	const [stream] = streams;
	if (recognized.length === 1 && recognized[0].rows.length === stream.rows.length) {
		// The same payments: either reading of a settled price makes the series fixed, so its price label holds.
		return [{...recognized[0], amountKind: stream.amountKind === 'FIXED' ? 'FIXED' : recognized[0].amountKind}];
	}
	// A fixed price that already spans more than the stream is the better reading of this history.
	const longerFixed = recognized.some(
		({rows, amountKind}) => amountKind === 'FIXED' && rows.length > stream.rows.length,
	);
	return longerFixed ? recognized : [stream];
}

function reconcileAccountSeries(
	series: readonly UndatedRecurringSeries[],
	candidates: readonly RecurringCandidate[],
	namingPeriod: NamingPeriodLookup,
): UndatedRecurringSeries[] {
	const byId = new Map(candidates.map((row) => [row.id, row]));
	// A stream is the account-local recognition, including every linked name and no unclassified activity.
	const sourceStreamById = new Map<string, ReadonlySet<string>>();
	for (const entry of series) {
		const ids = new Set(entry.transactionIds);
		for (const id of ids) sourceStreamById.set(id, ids);
	}
	const groups = new Map<string, UndatedRecurringSeries[]>();
	for (const entry of series) {
		const first = byId.get(entry.transactionIds[0])!;
		const groupKey = first.recurringPayeeKey
			? `${entry.merchantKey}\u0000${entry.currency}\u0000${entry.cadence}`
			: entry.key;
		const group = groups.get(groupKey) ?? [];
		group.push(entry);
		groups.set(groupKey, group);
	}
	return [...groups.values()]
		.flatMap((group) => {
			if (group.length === 1) return group;
			const whole = joinSeries(group, byId, namingPeriod);
			if (whole) return [whole];

			// An independent concurrent plan must not prevent an otherwise unique account continuation.
			// Consider the complete compatibility component, never greedily choose one ambiguous edge.
			const neighbours = group.map(() => [] as number[]);
			for (let left = 0; left < group.length; left++) {
				for (let right = left + 1; right < group.length; right++) {
					if (!joinSeries([group[left], group[right]], byId, namingPeriod)) continue;
					neighbours[left].push(right);
					neighbours[right].push(left);
				}
			}
			return connectedComponents(neighbours).flatMap((indices) => {
				const parts = indices.sort((a, b) => a - b).map((index) => group[index]);
				const joined = parts.length > 1 ? joinSeries(parts, byId, namingPeriod) : null;
				return joined ? [joined] : parts;
			});
		})
		.map((entry) => withCurrentSourceStream(entry, byId, sourceStreamById, namingPeriod));
}

function joinSeries(
	parts: readonly UndatedRecurringSeries[],
	byId: ReadonlyMap<string, RecurringCandidate>,
	namingPeriod: NamingPeriodLookup,
): UndatedRecurringSeries | null {
	const rows = parts.flatMap((entry) => entry.transactionIds.map((id) => grouped(byId.get(id)!, entry.merchantKey)));
	rows.sort(byDateThenId);
	const joined = completePartition(rows, false);
	if (joined?.cadence === parts[0].cadence) return joined;
	// Every member is already independently recognized. Validate continuity, not the share of old prices.
	const rule = matchCadence(rows);
	if (!rule || rule.cadence !== parts[0].cadence || hasRecurringOverlap(rows, rule)) return null;
	const currentRows = namingPeriod(rows, false, rule.cadence);
	if (!currentRows || currentRows.length === rows.length) return null;
	// A current period can supersede older evidence, not interleave with another recognized obligation.
	const currentIds = new Set(currentRows.map(({id}) => id));
	if (rows.some(({id, date}) => !currentIds.has(id) && date >= currentRows[0].date)) return null;
	const current = completePartition(currentRows, false)!;
	return buildSeries(rows, rule, current.amountKind, {priceRows: currentRows});
}

/** Every complete compatibility component, in the original traversal order. */
function connectedComponents(neighbours: readonly (readonly number[])[]): number[][] {
	const seen = new Set<number>();
	const components: number[][] = [];
	for (let start = 0; start < neighbours.length; start++) {
		if (seen.has(start)) continue;
		const stack = [start];
		const indices: number[] = [];
		while (stack.length) {
			const current = stack.pop()!;
			if (seen.has(current)) continue;
			seen.add(current);
			indices.push(current);
			stack.push(...neighbours[current]);
		}
		components.push(indices);
	}
	return components;
}

/** Older linked identities must not move an established current price or billing-day anchor. */
function withCurrentSourceStream(
	entry: UndatedRecurringSeries,
	byId: ReadonlyMap<string, RecurringCandidate>,
	sourceStreamById: ReadonlyMap<string, ReadonlySet<string>>,
	namingPeriod: NamingPeriodLookup,
): UndatedRecurringSeries {
	const sources = entry.transactionIds.map((id) => byId.get(id)!);
	const latest = sources[sources.length - 1];
	if (!latest.recurringPayeeKey) return entry;
	const rows = sources.map((row) => grouped(row, entry.merchantKey));
	const rule = CADENCE_RULES.find(({cadence}) => cadence === entry.cadence)!;
	const calendarRows = (prefix: readonly RecurringCandidate[]) =>
		currentSourceRows(prefix, byId, sourceStreamById, rule, namingPeriod);
	const currentRows = calendarRows(rows);
	if (currentRows === rows) return entry;
	const [current] = detectPartition([...currentRows], false);
	return buildSeries(rows, rule, current.amountKind, {calendarRows, priceRows: currentRows});
}

function currentSourceRows(
	rows: readonly RecurringCandidate[],
	byId: ReadonlyMap<string, RecurringCandidate>,
	sourceStreamById: ReadonlyMap<string, ReadonlySet<string>>,
	rule: CadenceRule,
	namingPeriod: NamingPeriodLookup,
): readonly RecurringCandidate[] {
	const latest = byId.get(rows[rows.length - 1].id)!;
	const recognized = (prefix: RecurringCandidate[]) => completePartition(prefix, false)?.cadence === rule.cadence;
	const currentRows = namingPeriod(rows, false, rule.cadence);
	if (currentRows) return currentRows.length === rows.length ? rows : currentRows;
	// If no linked-name union qualifies, retain the exact recognized source stream, not other account activity.
	const sourceIds = sourceStreamById.get(latest.id)!;
	const sourceRows = rows.filter(({id}) => sourceIds.has(id));
	return sourceRows.length !== rows.length && recognized(sourceRows) ? sourceRows : rows;
}

type NamingPeriodCache = Map<string, {start: number | null; children: NamingPeriodCache}>;
type QualificationCache = {cadence?: RecurringCadence | null; children: Map<string, QualificationCache>};
type NamingPeriodLookup = (
	rows: readonly RecurringCandidate[],
	person: boolean,
	cadence?: RecurringCadence,
) => RecurringCandidate[] | null;

/** Cache exact membership qualification and prefix boundaries only for this detector invocation. */
function createNamingPeriodLookup(byId: ReadonlyMap<string, RecurringCandidate>): NamingPeriodLookup {
	const periods = new Map<string, NamingPeriodCache>();
	const qualifications = new Map<boolean, QualificationCache>();
	return (rows, person, cadence) => {
		const mode = `${person}:${cadence ?? ''}`;
		if (!periods.has(mode)) periods.set(mode, new Map());
		if (!qualifications.has(person)) qualifications.set(person, {children: new Map()});
		return latestNamingPeriod(
			rows,
			byId,
			(part) => {
				let qualified = qualifications.get(person)!;
				for (const {id} of part) {
					if (!qualified.children.has(id)) qualified.children.set(id, {children: new Map()});
					qualified = qualified.children.get(id)!;
				}
				if (qualified.cadence === undefined) {
					const detected = recognizePartition([...part], person);
					qualified.cadence =
						detected.length === 1 && detected[0].rows.length === part.length
							? detected[0].rule.cadence
							: null;
				}
				return qualified.cadence !== null && (!cadence || qualified.cadence === cadence);
			},
			periods.get(mode)!,
		);
	};
}

/**
 * Continue an established chronological period before reopening an older name's whole lifetime. A newer naming
 * interval may supersede it, but must include every interleaved name. Both paths use the existing recognition rules.
 * The prefix trie is local to one recognition predicate/request; calendar and restart checks share its exact evidence.
 */
function latestNamingPeriod(
	rows: readonly RecurringCandidate[],
	byId: ReadonlyMap<string, RecurringCandidate>,
	recognized: (part: RecurringCandidate[]) => boolean,
	cache: NamingPeriodCache,
): RecurringCandidate[] | null {
	const latest = byId.get(rows[rows.length - 1].id)!;
	const accountRows = rows.filter(({id}) => byId.get(id)!.bankAccountId === latest.bankAccountId);
	const firstByKey = new Map<string, number>();
	let start: number | null = null;
	for (const [index, {id}] of accountRows.entries()) {
		const key = byId.get(id)!.merchantKey;
		if (!firstByKey.has(key)) firstByKey.set(key, index);
		let node = cache.get(id);
		if (!node) {
			// With one raw name, the only naming interval is the whole prefix. It cannot establish a later boundary.
			let current: number | null = null;
			if (firstByKey.size > 1) {
				if (start !== null && start > 0 && recognized(accountRows.slice(start, index + 1))) current = start;
				let boundary = index + 1;
				while (boundary > (current ?? -1) && boundary > 0) {
					boundary--;
					for (let member = boundary; member >= boundary; member--) {
						boundary = Math.min(boundary, firstByKey.get(byId.get(accountRows[member].id)!.merchantKey)!);
					}
					if (current !== null && boundary <= current) break;
					if (recognized(accountRows.slice(boundary, index + 1))) {
						current = boundary;
						break;
					}
				}
			}
			node = {start: current, children: new Map()};
			cache.set(id, node);
		}
		start = node.start;
		cache = node.children;
	}
	if (firstByKey.size === 1) return recognized(accountRows) ? accountRows : null;
	return start === null ? null : accountRows.slice(start);
}

export function isPersonTransferCategory({category}: Pick<RecurringCandidate, 'category'>): boolean {
	return category !== null && PERSON_TRANSFER_CATEGORIES.has(category);
}

export function foldName(name: string): string {
	return name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
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
		if (best) {
			const prefix = best.slice(0, -1);
			const rule = matchCadence(prefix);
			if (rule) {
				const expected = toDayNumber(addCycles(prefix, rule, 1));
				const last = best[best.length - 1];
				// A later on-time payment disambiguates an earlier same-amount outlier in its cycle.
				if (
					toDayNumber(last.date) < expected - rule.toleranceDays &&
					Math.abs(toDayNumber(row.date) - expected) <= rule.toleranceDays
				) {
					best.pop();
					chains.push([last]);
				}
			}
			best.push(row);
		} else chains.push([row]);
	}
	return chains;
}

/** Join only mutually unique, next-cycle price transitions; overlapping plans never become candidates. */
function successivePriceChains(
	chains: readonly RecurringCandidate[][],
	cadenceOf: (rows: readonly RecurringCandidate[]) => CadenceRule | null,
): RecurringCandidate[][] {
	const rules = chains.map(cadenceOf);
	const successors = chains.map(() => [] as number[]);
	const predecessors = chains.map(() => [] as number[]);
	for (let from = 0; from < chains.length; from++) {
		const rule = rules[from];
		if (!rule) continue;
		for (let to = from + 1; to < chains.length; to++) {
			if (rules[to]?.cadence !== rule.cadence) continue;
			const older = chains[from];
			const newer = chains[to];
			const gap = toDayNumber(newer[0].date) - toDayNumber(older[older.length - 1].date);
			if (Math.abs(gap - rule.nominalDays) > rule.toleranceDays) continue;
			const joined = [...older, ...newer];
			if (cadenceOf(joined)?.cadence !== rule.cadence || !latestPricePeriod(joined, [older, newer], rule))
				continue;
			successors[from].push(to);
			predecessors[to].push(from);
		}
	}

	// Count all alternatives before consuming anything, so iteration order cannot resolve an ambiguous match.
	const consumed = new Set<number>();
	const result: RecurringCandidate[][] = [];
	for (let start = 0; start < chains.length; start++) {
		if (consumed.has(start)) continue;
		let joined = chains[start];
		let current = start;
		while (successors[current].length === 1) {
			const next = successors[current][0];
			if (predecessors[next].length !== 1) break;
			const extended = [...joined, ...chains[next]];
			const rule = cadenceOf(extended);
			if (!rule || !latestPricePeriod(extended, chains, rule)) break;
			joined = extended;
			consumed.add(next);
			current = next;
		}
		result.push(joined);
	}
	return retainIsolatedPayments(result, chains, cadenceOf);
}

/** Keep an isolated payment only when one established stream has an empty cadence slot for it. */
function retainIsolatedPayments(
	groups: readonly RecurringCandidate[][],
	chains: readonly RecurringCandidate[][],
	cadenceOf: (rows: readonly RecurringCandidate[]) => CadenceRule | null,
): RecurringCandidate[][] {
	const established = groups.flatMap((rows) => {
		const rule = cadenceOf(rows);
		return rule ? [{rows, rule, additions: [] as RecurringCandidate[]}] : [];
	});
	for (const chain of chains) {
		if (cadenceOf(chain)) continue;
		for (const row of chain) {
			const owners = established.filter(({rows, rule}) => {
				const neighbours = [
					rows.findLast(({date}) => date <= row.date),
					rows.find(({date}) => date >= row.date),
				];
				return neighbours.every(
					(neighbour) =>
						!neighbour ||
						Math.abs(Math.abs(toDayNumber(row.date) - toDayNumber(neighbour.date)) - rule.nominalDays) <=
							rule.toleranceDays,
				);
			});
			if (owners.length === 1) owners[0].additions.push(row);
		}
	}
	return groups.map((rows) => {
		const owner = established.find((entry) => entry.rows === rows);
		// Do not widen unchanged fixed chains, or choose between competing isolated payments in the same slot.
		if (chains.includes(rows) || !owner?.additions.length) return rows;
		// Reject only competing additions in the same cadence slot, not independent additions elsewhere.
		const additions = owner.additions.filter((row) =>
			owner.additions.every(
				(other) =>
					row === other ||
					Math.abs(toDayNumber(row.date) - toDayNumber(other.date)) >=
						owner.rule.nominalDays - owner.rule.toleranceDays,
			),
		);
		const extended = [...rows, ...additions].sort(byDateThenId);
		return cadenceOf(extended)?.cadence === owner.rule.cadence && latestPricePeriod(extended, chains, owner.rule)
			? extended
			: rows;
	});
}

/**
 * One payer's streams. Usually one: the longest rhythm, with leftovers that have no rhythm of their own. When every
 * leftover payment is a second plan at a fixed price on its own rhythm, both are streams. Any other rhythmic leftover,
 * as at a busy shop, means the payer has no single stream.
 */
function rhythmStreams(
	rows: readonly RecurringCandidate[],
	cadenceOf: (rows: readonly RecurringCandidate[]) => CadenceRule | null,
	person: boolean,
): RecognizedPartition[] {
	const single = rhythmStream(rows, cadenceOf, false, person);
	if (single) return [single];
	const main = rhythmStream(rows, cadenceOf, true, person);
	if (!main) return [];
	const inMain = new Set(main.rows);
	const outside = rows.filter((row) => !inMain.has(row));
	const second = rhythmStream(outside, cadenceOf, false, person);
	return second?.amountKind === 'FIXED' && second.rows.length === outside.length ? [main, second] : [];
}

/**
 * The longest run of payments, one per cycle, that follows a cadence. With `rhythmicLeftovers` false, payments left
 * outside it must not follow a cadence of their own.
 */
function rhythmStream(
	rows: readonly RecurringCandidate[],
	cadenceOf: (rows: readonly RecurringCandidate[]) => CadenceRule | null,
	rhythmicLeftovers: boolean,
	person: boolean,
): RecognizedPartition | null {
	let best: RecognizedPartition | null = null;
	for (const rule of CADENCE_RULES) {
		const candidate = rhythmPath(rows, rule);
		if (!candidate) continue;
		const path = qualifiedBillingHistory(candidate, person);
		if (cadenceOf(path)?.cadence !== rule.cadence) continue;
		const inPath = new Set(path);
		const outside = rows.filter((row) => !inPath.has(row));
		// A second charge on a stream payment's own day is billed alongside it, not a one-off.
		const days = new Set(path.map(({date}) => date));
		if (outside.some(({date}) => days.has(date))) continue;
		if (alternatesPrices(path) || hasOtherCadencePrice(path, rule)) continue;
		const amountKind = streamAmountKind(path, rule);
		if (amountKind === 'VARIABLE' && !variableAllowed(rule, path, person)) continue;
		// A varying bill must explain most activity during its own span, not cherry-pick a minority of purchases.
		// With rhythmic leftovers, the caller requires every other payment to belong to a second fixed plan.
		if (
			amountKind === 'VARIABLE' &&
			!rhythmicLeftovers &&
			parseMerchantKey(path[0].merchantKey).direction === 'EXPENSE'
		) {
			const inSpan = rows.filter(({date}) => date >= path[0].date && date <= path[path.length - 1].date);
			if (path.length * 2 <= inSpan.length) continue;
		}
		// Varying amounts with mixed payment purposes are separate purchases, not one bill.
		const purposes = new Set(path.flatMap(({category}) => (category ? [category] : [])));
		if (amountKind === 'VARIABLE' && purposes.size > 1) continue;
		if (best && path.length <= best.rows.length) continue;
		// Payments outside the stream with a rhythm of their own are another obligation.
		if (!rhythmicLeftovers && CADENCE_RULES.some((other) => cadenceOf(rhythmPath(outside, other) ?? []))) continue;
		best = {rows: [...path], rule, amountKind};
	}
	return best;
}

/**
 * Two plans paid in turn: a price seen once between two payments of another price, then again within a few cycles.
 * A one-off between them does not come back that soon.
 */
function alternatesPrices(rows: readonly RecurringCandidate[]): boolean {
	const near = (a: RecurringCandidate, b: RecurringCandidate) => nearAmount(a.amountCents, b.amountCents);
	return rows.some(
		(row, index) =>
			index > 0 &&
			index < rows.length - 1 &&
			!near(row, rows[index - 1]) &&
			!near(row, rows[index + 1]) &&
			near(rows[index - 1], rows[index + 1]) &&
			rows.slice(index + 2, index + 2 + MAX_CYCLES_PER_GAP).some((later) => near(later, row)),
	);
}

/** A sustained price inside the stream that keeps its own different cadence is a different obligation. */
function hasOtherCadencePrice(rows: readonly RecurringCandidate[], rule: CadenceRule): boolean {
	return chainByAmount(rows).some((chain) => {
		if (chain.length < rule.minCount) return false;
		const matches = matchingCadences(chain);
		return matches.length > 0 && !matches.includes(rule);
	});
}

/** The most payments that follow each other at a regular gap of the rule; ties go to the most even gaps. */
function rhythmPath(rows: readonly RecurringCandidate[], rule: CadenceRule): RecurringCandidate[] | null {
	const days = rows.map((row) => toDayNumber(row.date));
	const maxGap = rule.nominalDays * MAX_CYCLES_PER_GAP + rule.toleranceDays;
	const count: number[] = [];
	const drift: number[] = [];
	const previous: number[] = [];
	let end = -1;
	for (let index = 0; index < rows.length; index++) {
		count[index] = 1;
		drift[index] = 0;
		previous[index] = -1;
		for (let before = index - 1; before >= 0 && days[index] - days[before] <= maxGap; before--) {
			const gap = days[index] - days[before];
			if (!isRegularGap(gap, rule)) continue;
			const cycles = Math.max(1, Math.round(gap / rule.nominalDays));
			const candidateDrift = drift[before] + Math.abs(gap - cycles * rule.nominalDays);
			if (
				count[before] + 1 > count[index] ||
				(count[before] + 1 === count[index] && candidateDrift < drift[index])
			) {
				count[index] = count[before] + 1;
				drift[index] = candidateDrift;
				previous[index] = before;
			}
		}
		if (end < 0 || count[index] > count[end] || (count[index] === count[end] && drift[index] < drift[end])) {
			end = index;
		}
	}
	if (end < 0 || count[end] < rule.minCount) return null;
	const path: RecurringCandidate[] = [];
	for (let index = end; index >= 0; index = previous[index]) path.unshift(rows[index]);
	return path;
}

/** Chronological periods at one billing price, shared by qualification and history selection. */
function priceRuns(rows: readonly RecurringCandidate[]): RecurringCandidate[][] {
	const runs: RecurringCandidate[][] = [];
	for (const row of rows) {
		const run = runs[runs.length - 1];
		if (run && nearAmount(row.amountCents, run[run.length - 1].amountCents)) run.push(row);
		else runs.push([row]);
	}
	return runs;
}

/**
 * Fixed when most payments sit in sustained prices and the current price is sustained or a fresh change after one;
 * otherwise the amount varies.
 */
function streamAmountKind(rows: readonly RecurringCandidate[], rule: CadenceRule): RecurringAmountKind {
	const runs = priceRuns(rows);
	const sustained = (run: readonly RecurringCandidate[]) => run.length >= rule.minCount;
	const current = runs[runs.length - 1];
	const changing = !sustained(current) && runs.length > 1 && sustained(runs[runs.length - 2]);
	if (!sustained(current) && !changing) return 'VARIABLE';
	const settled = runs.filter(sustained).reduce((total, run) => total + run.length, 0);
	return settled + (changing ? current.length : 0) >= rows.length * MIN_REGULAR_GAP_SHARE ? 'FIXED' : 'VARIABLE';
}

/** Occasional extra charges can belong to one variable bill; a repeated overlapping rhythm is another obligation. */
function hasRecurringOverlap(rows: readonly RecurringCandidate[], rule: CadenceRule): boolean {
	const overlapping = shortGapRows(rows, rule);
	// Use the detector's actual cadence rule on short witnesses, including a skipped cycle.
	const followsCadence = (path: readonly RecurringCandidate[], lastIndex: number): boolean => {
		if (matchCadence(path)?.cadence === rule.cadence) return true;
		if (path.length >= rule.minCount + 1) return false;
		for (let next = lastIndex + 1; next < overlapping.length; next++) {
			const gap = toDayNumber(overlapping[next].date) - toDayNumber(overlapping[lastIndex].date);
			if (gap > rule.nominalDays * MAX_CYCLES_PER_GAP + rule.toleranceDays) break;
			if (isRegularGap(gap, rule) && followsCadence([...path, overlapping[next]], next)) return true;
		}
		return false;
	};
	return overlapping.some((row, index) => followsCadence([row], index));
}

function hasOverlappingCycles(rows: readonly RecurringCandidate[], rule: CadenceRule): boolean {
	return shortGapRows(rows, rule).length > 0;
}

/** Payments that came sooner after the one before than the cadence allows: a second obligation in the same cycle. */
function shortGapRows(rows: readonly RecurringCandidate[], rule: CadenceRule): RecurringCandidate[] {
	return rows.filter(
		(row, index) =>
			index > 0 &&
			toDayNumber(row.date) - toDayNumber(rows[index - 1].date) < rule.nominalDays - rule.toleranceDays,
	);
}

/** Sustained sequential prices are one fixed obligation; isolated amounts do not establish a new price. */
function latestPricePeriod(
	rows: readonly RecurringCandidate[],
	chains: readonly RecurringCandidate[][],
	rule: CadenceRule,
): RecurringCandidate[] | null {
	// A short gap means two obligations in one cycle, not a price change (even if the median rhythm still fits).
	if (hasOverlappingCycles(rows, rule)) return null;
	const chainOf = new Map<RecurringCandidate, RecurringCandidate[]>();
	for (const chain of chains) {
		if (chain.length >= rule.minCount) for (const row of chain) chainOf.set(row, chain);
	}
	const periods: RecurringCandidate[][] = [];
	let previous: RecurringCandidate[] | undefined;
	for (const row of rows) {
		const chain = chainOf.get(row);
		if (!chain) continue;
		if (chain === previous) periods[periods.length - 1].push(row);
		else periods.push([row]);
		previous = chain;
	}
	const sustained = periods.filter((period) => period.length >= rule.minCount);
	// Short interleavings of independently cadenced prices are ambiguous, not isolated prorations.
	if (
		periods.some(
			(period) =>
				period.length < rule.minCount && matchCadence(chainOf.get(period[0])!)?.cadence === rule.cadence,
		)
	)
		return null;
	if (
		sustained.some((period) => {
			const periodRule = matchCadence(period);
			return periodRule !== null && periodRule.cadence !== rule.cadence;
		})
	)
		return null;
	const sustainedCount = sustained.reduce((count, period) => count + period.length, 0);
	return sustained.length > 1 && sustainedCount / rows.length >= MIN_REGULAR_GAP_SHARE
		? sustained[sustained.length - 1]
		: null;
}

/** Whether `amount` is close enough to `reference` to be the same price. */
export function nearAmount(amount: bigint, reference: bigint): boolean {
	return withinAmountTolerance(abs(amount - reference), reference);
}

/** Whether two amounts this far apart are close enough to be one fixed price. */
function withinAmountTolerance(distance: bigint, reference: bigint): boolean {
	const percentTolerance = (reference * AMOUNT_TOLERANCE_PERCENT) / 100n;
	return distance <= (percentTolerance > AMOUNT_TOLERANCE_CENTS ? percentTolerance : AMOUNT_TOLERANCE_CENTS);
}

function matchingCadences(rows: readonly RecurringCandidate[]): CadenceRule[] {
	if (rows.length < 2) return [];
	const days = rows.map((row) => toDayNumber(row.date));
	const gaps = days.slice(1).map((day, index) => day - days[index]);
	const medianGap = medianNumber(gaps);
	return CADENCE_RULES.filter((rule) => {
		const [min, max] = rule.medianGap;
		if (medianGap < min || medianGap > max || rows.length < rule.minCount) return false;
		if (
			rule.cadence === 'FOUR_WEEKLY' &&
			!cadenceDistances(rows, days, rule).every((distance) => distance <= rule.toleranceDays)
		)
			return false;
		const regular = gaps.filter((gap) => isRegularGap(gap, rule)).length;
		return regular / gaps.length >= MIN_REGULAR_GAP_SHARE;
	});
}

function matchCadence(rows: readonly RecurringCandidate[]): CadenceRule | null {
	const matches = matchingCadences(rows);
	if (matches.length < 2) return matches[0] ?? null;
	const days = rows.map((row) => toDayNumber(row.date));
	// Keep a calendar-compatible history monthly unless the bank dates prove an exact fixed-day phase.
	const scored = matches.map((rule) => ({rule, distances: cadenceDistances(rows, days, rule)}));
	const monthly = scored.find(({rule}) => rule.cadence === 'MONTHLY');
	const fourWeekly = scored.find(({rule}) => rule.cadence === 'FOUR_WEEKLY');
	if (
		monthly &&
		fourWeekly &&
		monthly.distances.every((distance) => distance <= monthly.rule.toleranceDays) &&
		!days.every((day) => (day - days[0]) % fourWeekly.rule.nominalDays === 0)
	)
		return monthly.rule;
	return scored
		.map(({rule, distances}) => ({rule, drift: distances.reduce((total, distance) => total + distance, 0)}))
		.sort((a, b) => a.drift - b.drift || Number(b.rule.months > 0) - Number(a.rule.months > 0))[0].rule;
}

/** Distances from one stable billing phase, using the same calendar anchors as forecasting. */
function cadenceDistances(rows: readonly RecurringCandidate[], days: readonly number[], rule: CadenceRule): number[] {
	if (rule.months === 0) {
		const offsets = days.map((day) => {
			const elapsed = day - days[0];
			return elapsed - Math.round(elapsed / rule.nominalDays) * rule.nominalDays;
		});
		const phase = medianNumber(offsets);
		return offsets.map((offset) => Math.abs(offset - phase));
	}
	const anchorDay = calendarAnchorDay(
		rows.map(({date}) => Number(date.slice(8, 10))),
		Number(rows.at(-1)!.date.slice(8, 10)),
	);
	return rows.map((row, index) => Math.abs(days[index] - toDayNumber(calendarPaymentDate(row.date, anchorDay))));
}

function isRegularGap(gap: number, rule: CadenceRule): boolean {
	for (let cycles = 1; cycles <= MAX_CYCLES_PER_GAP; cycles++) {
		if (Math.abs(gap - cycles * rule.nominalDays) <= rule.toleranceDays) return true;
	}
	return false;
}

/**
 * Renders the newer part of an established monthly stream with the existing price/calendar contract. This does not
 * qualify a new series: callers must validate its complete union with the established history before exposing it.
 */
export function monthlyContinuationPart(rows: readonly RecurringCandidate[]): UndatedRecurringSeries {
	return buildSeries(
		[...rows].sort(byDateThenId),
		CADENCE_RULES.find(({cadence}) => cadence === 'MONTHLY')!,
		'FIXED',
	);
}

/** The chronological history ends in an established run at exactly this monthly price. */
export function hasSettledMonthlyPrice(rows: readonly RecurringCandidate[], amountCents: bigint): boolean {
	const {minCount} = CADENCE_RULES.find(({cadence}) => cadence === 'MONTHLY')!;
	return rows.length >= minCount && rows.slice(-minCount).every((row) => row.amountCents === amountCents);
}

/** Whether every appended payment occupies a monthly slot under the detector's calendar, drift and skipped cycles. */
export function occupiesMonthlySlots(
	older: readonly RecurringCandidate[],
	newer: readonly RecurringCandidate[],
): boolean {
	const rule = CADENCE_RULES.find(({cadence}) => cadence === 'MONTHLY')!;
	const prefix = [...older].sort(byDateThenId);
	for (const row of [...newer].sort(byDateThenId)) {
		let matches = false;
		for (let cycles = 1; cycles <= MAX_CYCLES_PER_GAP; cycles++) {
			if (Math.abs(toDayNumber(row.date) - toDayNumber(addCycles(prefix, rule, cycles))) <= rule.toleranceDays) {
				matches = true;
				break;
			}
		}
		if (!matches) return false;
		prefix.push(row);
	}
	return true;
}

function buildSeries(
	rows: readonly RecurringCandidate[],
	rule: CadenceRule,
	amountKind: RecurringAmountKind,
	{
		calendarRows,
		priceRows = rows,
	}: {
		calendarRows?: (prefix: readonly RecurringCandidate[]) => readonly RecurringCandidate[];
		/** The current naming period's payments for a varying amount; all payments by default. */
		priceRows?: readonly RecurringCandidate[];
	} = {},
): UndatedRecurringSeries {
	const first = rows[0];
	const latest = rows[rows.length - 1];
	const expectedDate = (prefix: readonly RecurringCandidate[]) =>
		addCycles(calendarRows?.(prefix) ?? prefix, rule, 1);
	const direction =
		parseMerchantKey(first.merchantKey).direction === BANK_TRANSACTION_DIRECTIONS.INCOME
			? BANK_TRANSACTION_DIRECTIONS.INCOME
			: BANK_TRANSACTION_DIRECTIONS.EXPENSE;
	const converted = rows.every((row) => row.baseAmountCents !== null);
	const perMonth = (perPayment: bigint) => {
		const [numerator, denominator] = rule.monthlyRatio;
		return divideRounded(perPayment * numerator, denominator);
	};
	const amounts =
		amountKind === 'FIXED'
			? fixedAmounts(rows, converted, perMonth)
			: variableAmounts(priceRows, rule, direction, converted, perMonth);

	return {
		key: seriesKey(first.merchantKey, first.currency, first.id),
		merchantKey: first.merchantKey,
		name: latest.name,
		direction,
		cadence: rule.cadence,
		amountKind,
		currency: first.currency,
		latestAmount: formatCents(latest.amountCents),
		...amounts,
		transactionIds: rows.map((row) => row.id),
		restartTransactionIds: rows
			.filter((row, index) => index > 0 && row.date > addDays(expectedDate(rows.slice(0, index)), GRACE_DAYS))
			.map((row) => row.id),
		firstDate: first.date,
		lastDate: latest.date,
		nextExpectedDate: expectedDate(rows),
		category: latest.category,
	};
}

type SeriesAmounts = Pick<
	UndatedRecurringSeries,
	| 'typicalAmount'
	| 'usualMonthlyEquivalent'
	| 'usualBaseAmount'
	| 'paidMonthlyEquivalent'
	| 'amountRange'
	| 'recentPayments'
	| 'higherThanUsual'
	| 'priceChange'
>;

/** A fixed price shows and costs its shown payment. */
function fixedAmounts(
	rows: readonly RecurringCandidate[],
	converted: boolean,
	perMonth: (perPayment: bigint) => bigint,
): SeriesAmounts {
	const shown = shownPayment(rows);
	return {
		typicalAmount: formatCents(shown.amountCents),
		usualMonthlyEquivalent: converted ? perMonth(shown.baseAmountCents!) : null,
		usualBaseAmount: converted ? shown.baseAmountCents : null,
		paidMonthlyEquivalent: null,
		amountRange: null,
		recentPayments: [],
		higherThanUsual: false,
		priceChange: priceChange(rows, shown),
	};
}

/**
 * A varying amount shows the median of its recent payments, which one unusual payment does not move, and their range.
 * A monthly bill costs what was paid in the month its latest payment was made.
 */
function variableAmounts(
	rows: readonly RecurringCandidate[],
	rule: CadenceRule,
	direction: BankTransactionDirection,
	converted: boolean,
	perMonth: (perPayment: bigint) => bigint,
): SeriesAmounts {
	const recent = rows.slice(-RECENT_PAYMENTS);
	const amounts = recent.map(({amountCents}) => amountCents);
	const latest = recent[recent.length - 1];
	const before = amounts.slice(0, -1);
	const highestBefore = before.length ? maxCents(before) : 0n;
	const usualBaseAmount = converted ? medianCents(recent.map(({baseAmountCents}) => baseAmountCents!)) : null;
	return {
		typicalAmount: formatCents(medianCents(amounts)),
		usualMonthlyEquivalent: usualBaseAmount === null ? null : perMonth(usualBaseAmount),
		usualBaseAmount,
		paidMonthlyEquivalent: converted && rule.cadence === 'MONTHLY' ? latest.baseAmountCents : null,
		amountRange: {
			low: formatCents(amounts.reduce((low, amount) => (amount < low ? amount : low))),
			high: formatCents(maxCents(amounts)),
		},
		recentPayments: recent.map(({date, amountCents}) => ({date, amount: formatCents(amountCents)})),
		higherThanUsual:
			direction === BANK_TRANSACTION_DIRECTIONS.EXPENSE &&
			before.length >= MIN_USUAL_PAYMENTS &&
			latest.amountCents > highestBefore &&
			exceeds(latest.amountCents, highestBefore, HIGHER_THAN_USUAL),
		priceChange: null,
	};
}

function maxCents(values: readonly bigint[]): bigint {
	return values.reduce((high, amount) => (amount > high ? amount : high));
}

/**
 * The payment whose amount the series shows: the latest one, unless it jumped away from the amount shown before it.
 * A jump becomes the shown amount once it repeats: the payment after it stays near it, or one of the few payments
 * before it was the same amount. Until then it is a one-off.
 */
function shownPayment(rows: readonly RecurringCandidate[]): RecurringCandidate {
	let shown = rows[0];
	for (let index = 1; index < rows.length; index++) {
		const row = rows[index];
		const next = rows[index + 1];
		const followed = next !== undefined && !exceeds(next.amountCents, row.amountCents, SPIKE);
		const seen = rows
			.slice(Math.max(0, index - REPEAT_LOOKBACK_PAYMENTS), index)
			.some(({amountCents}) => nearAmount(amountCents, row.amountCents));
		if (followed || seen || !exceeds(row.amountCents, shown.amountCents, SPIKE)) shown = row;
	}
	return shown;
}

type Threshold = {percent: bigint; cents: bigint};

/** Whether `amount` is further from `price` than both parts of the threshold. */
function exceeds(amount: bigint, price: bigint, {percent, cents}: Threshold): boolean {
	const distance = abs(amount - price);
	return distance > cents && distance * 100n > price * percent;
}

/** The shown price against the price before its current run, while that run is short. */
function priceChange(rows: readonly RecurringCandidate[], shown: RecurringCandidate): RecurringPriceChange | null {
	const latest = rows[rows.length - 1];
	// A one-off payment is not a new price.
	if (shown !== latest) return null;
	let start = rows.length - 1;
	while (start > 0 && !exceeds(rows[start - 1].amountCents, shown.amountCents, PRICE_CHANGE)) start--;
	if (start === 0 || rows.length - start > PRICE_CHANGE_SHOWN_PAYMENTS) return null;
	const before = shownPayment(rows.slice(0, start)).amountCents;
	if (!exceeds(shown.amountCents, before, PRICE_CHANGE)) return null;
	return {amount: formatCents(shown.amountCents - before), since: rows[start].date};
}

/** Stays the same as new payments arrive; decisions follow other changes through their payments. */
export function seriesKey(merchantKey: string, currency: string, firstId: string) {
	return createHash('sha256').update([merchantKey, currency, firstId].join('\u0000')).digest('hex').slice(0, 32);
}

function addCycles(rows: readonly RecurringCandidate[], rule: CadenceRule, cycles: number): string {
	const lastDate = rows[rows.length - 1].date;
	if (rule.months === 0) return addDays(lastDate, rule.nominalDays * cycles);
	// Month-based series keep their usual day of the month, clamped to shorter months.
	const days = rows.map((row) => Number(row.date.slice(8, 10)));
	const anchorDay = calendarAnchorDay(days, days[days.length - 1]);
	const [year, month] = calendarPaymentDate(lastDate, anchorDay).split('-').map(Number);
	return anchorDate(year, month - 1 + rule.months * cycles, anchorDay);
}

/** The calendar slot paid by a date, allowing early/late bank dates across a month boundary. */
function calendarPaymentDate(date: string, anchorDay: number): string {
	const [year, month] = date.split('-').map(Number);
	// A payment made a few days early, across a month boundary, still pays the month it was due in.
	return [-1, 0, 1]
		.map((offset) => anchorDate(year, month - 1 + offset, anchorDay))
		.reduce((best, candidate) =>
			Math.abs(toDayNumber(candidate) - toDayNumber(date)) < Math.abs(toDayNumber(best) - toDayNumber(date))
				? candidate
				: best,
		);
}

/**
 * Unwrap the day-of-month circle at its largest gap before taking the usual median. When the history splits evenly
 * between two days far apart (a billing day that moved), the median follows the side of the latest payment.
 */
function calendarAnchorDay(days: readonly number[], latestDay: number): number {
	const sorted = [...days].sort((a, b) => a - b);
	let start = 0;
	let largestGap = sorted[0] + 31 - sorted[sorted.length - 1];
	for (let index = 1; index < sorted.length; index++) {
		const gap = sorted[index] - sorted[index - 1];
		if (gap > largestGap) {
			largestGap = gap;
			start = index;
		}
	}
	const unwrapped = sorted.map((day) => (day < sorted[start] ? day + 31 : day)).sort((a, b) => a - b);
	const middle = Math.floor(unwrapped.length / 2);
	const wrap = (day: number) => ((day - 1) % 31) + 1;
	// Two payments on each side before it counts as a moved day; a single early payment is just early.
	if (
		unwrapped.length >= 4 &&
		unwrapped.length % 2 === 0 &&
		unwrapped[middle] - unwrapped[middle - 1] > MAX_MIDDLE_SPREAD_DAYS
	) {
		const distance = (day: number) =>
			Math.min(Math.abs(wrap(day) - latestDay), 31 - Math.abs(wrap(day) - latestDay));
		const [lower, upper] = [unwrapped[middle - 1], unwrapped[middle]];
		return wrap(distance(upper) < distance(lower) ? upper : lower);
	}
	return wrap(Math.round(medianNumber(unwrapped)));
}

/** The anchor day in a month counted from January of `year` (0-based, may overflow), clamped to its length. */
function anchorDate(year: number, monthIndex: number, anchorDay: number): string {
	const target = new Date(Date.UTC(year, monthIndex, 1));
	const lastDayOfMonth = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
	target.setUTCDate(Math.min(anchorDay, lastDayOfMonth));
	return target.toISOString().slice(0, 10);
}

function byDateThenId(a: RecurringCandidate, b: RecurringCandidate): number {
	return a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
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

function abs(value: bigint): bigint {
	return value < 0n ? -value : value;
}
