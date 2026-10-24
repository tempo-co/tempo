import {parseMerchantKey} from '../categorization/bank-transaction-merchant-key';
import {parseCents} from '../summary/bank-transaction-summary';
import {normalizedPayeeName} from './recurring-payee-identity';
import {
	type RecurringCandidate,
	type UndatedRecurringSeries,
	detectUndatedRecurringSeries,
	foldName,
	hasSettledMonthlyPrice,
	isPersonTransferCategory,
	monthlyContinuationPart,
	nearAmount,
	occupiesMonthlySlots,
} from './recurring-series-detection';
import {isOrdinaryRetailExpense} from './recurring-series-eligibility';

/** Two successive histories of one obligation; they are joined unless the owner unlinks them. */
export type ContinuationPair = {
	older: UndatedRecurringSeries;
	newer: UndatedRecurringSeries;
	/** The detector's history for both together, as it would read once linked. */
	joined: UndatedRecurringSeries;
};

/** The detector's single history for both together, or null when it would not keep their union whole. */
export function joinContinuation(
	older: UndatedRecurringSeries,
	newer: UndatedRecurringSeries,
	candidatesById: ReadonlyMap<string, RecurringCandidate>,
): UndatedRecurringSeries | null {
	// The pair is replayed under its own identity, so its rows group together whatever their own payee keys.
	const recurringPayeeKey = `${older.direction}:continuation:${older.key}:${newer.key}`;
	const ids = new Set([...older.transactionIds, ...newer.transactionIds]);
	const rows = [...ids].map((id) => ({...candidatesById.get(id)!, recurringPayeeKey}));
	const joined = detectUndatedRecurringSeries(rows);
	if (joined.length !== 1 || joined[0].transactionIds.length !== ids.size) return null;
	return joined[0];
}

/**
 * Finds uniquely compatible renamed streams, replaying every proposed union through the detector. Company histories
 * keep their existing name-prefix/price rules. An established fixed monthly bill may continue from an underqualified newer
 * part with omitted whole name components, exact price, known purpose, same account and compatible billing slots.
 * The returned newer part is continuation-backed, not a newly qualified series; callers retain it for Unlink/relink.
 */
export function findContinuationPairs(
	series: readonly UndatedRecurringSeries[],
	candidatesById: ReadonlyMap<string, RecurringCandidate>,
): ContinuationPair[] {
	const pairs: ContinuationPair[] = [];
	const recognized = new Set(series.flatMap(({transactionIds}) => transactionIds));
	const tails = new Map<string, RecurringCandidate[]>();
	for (const row of candidatesById.values()) {
		if (recognized.has(row.id)) continue;
		const key = JSON.stringify([row.bankAccountId, row.merchantKey, row.currency, row.category]);
		const tail = tails.get(key) ?? [];
		tail.push(row);
		tails.set(key, tail);
	}
	for (const older of series) {
		for (const group of tails.values()) {
			// Consider the proposed price cohort, not a name's lifetime of unrelated purchases. Include nearby prices
			// before the exact-price guard, so a varying new bill cannot be reduced to its one matching payment.
			const rows = group.filter(({amountCents}) => nearAmount(amountCents, parseCents(older.typicalAmount)));
			if (rows.length === 0) continue;
			if (!fixedMonthlyContinuation(older, rows, candidatesById)) continue;
			const newer = monthlyContinuationPart(rows);
			const joined = joinContinuation(older, newer, candidatesById);
			if (joined) pairs.push({older, newer, joined});
		}
		for (const newer of series) {
			if (older === newer || older.lastDate >= newer.firstDate) continue;
			if (!(
				fixedMonthlyContinuation(
					older,
					newer.transactionIds.map((id) => candidatesById.get(id)!),
					candidatesById,
				) ||
				(compatible(older, newer, candidatesById) && continuesName(older, newer))
			))
				continue;
			const joined = joinContinuation(older, newer, candidatesById);
			if (joined) pairs.push({older, newer, joined});
		}
	}
	// A history that could continue in more than one way is ambiguous; never pick one.
	const uses = new Map<string, number>();
	for (const {older, newer} of pairs) {
		for (const {key} of [older, newer]) uses.set(key, (uses.get(key) ?? 0) + 1);
	}
	return pairs.filter(({older, newer}) => uses.get(older.key) === 1 && uses.get(newer.key) === 1);
}

/** Strong stream evidence permits omitted whole name components without changing either payee identity. */
function fixedMonthlyContinuation(
	older: UndatedRecurringSeries,
	newRows: readonly RecurringCandidate[],
	candidatesById: ReadonlyMap<string, RecurringCandidate>,
): boolean {
	if (older.cadence !== 'MONTHLY' || older.amountKind !== 'FIXED') return false;
	if (newRows.some(({date}) => date <= older.lastDate)) return false;
	const oldRows = older.transactionIds.map((id) => candidatesById.get(id)!);
	const rows = [...oldRows, ...newRows];
	if (
		newRows.some(
			({merchantKey, currency}) =>
				parseMerchantKey(merchantKey).direction !== older.direction || currency !== older.currency,
		)
	)
		return false;
	if (new Set(rows.map(({bankAccountId}) => bankAccountId)).size !== 1) return false;
	const purposes = new Set(rows.map(({category}) => category));
	if (purposes.size !== 1 || purposes.has(null) || rows.some(isPersonTransferCategory)) return false;
	if (isOrdinaryRetailExpense(older, candidatesById)) return false;
	const price = parseCents(older.typicalAmount);
	if (!hasSettledMonthlyPrice(oldRows, price) || newRows.some(({amountCents}) => amountCents !== price)) return false;
	if (new Set(rows.flatMap(({recipientIbans}) => recipientIbans ?? [])).size > 1) return false;
	const words = ({merchantKey, personTransfer}: RecurringCandidate) => {
		const name = foldName(parseMerchantKey(merchantKey).name);
		// Legacy stored keys may contain the transfer label; it is not part of a person's full name.
		return (personTransfer ? name.replace(/^transfer (?:to|from)\s+/, '') : name).split(/[\s-]+/);
	};
	const a = words(oldRows[0]);
	const b = words(newRows[0]);
	const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
	if (shorter.length < 2 || shorter.length === longer.length || a[0] !== b[0] || a.at(-1) !== b.at(-1)) return false;
	let index = 0;
	for (const word of longer) if (word === shorter[index]) index++;
	return index === shorter.length && occupiesMonthlySlots(oldRows, newRows);
}

function compatible(
	older: UndatedRecurringSeries,
	newer: UndatedRecurringSeries,
	candidatesById: ReadonlyMap<string, RecurringCandidate>,
): boolean {
	if (
		older.direction !== newer.direction ||
		older.currency !== newer.currency ||
		older.cadence !== newer.cadence ||
		older.amountKind !== 'FIXED' ||
		newer.amountKind !== 'FIXED'
	)
		return false;
	const rows = [...older.transactionIds, ...newer.transactionIds].map((id) => candidatesById.get(id)!);
	if (new Set(rows.flatMap(({recipientIbans}) => recipientIbans ?? [])).size > 1) return false;
	if (rows.some((row) => row.personTransfer || isPersonTransferCategory(row))) return false;
	if (isOrdinaryRetailExpense(older, candidatesById) || isOrdinaryRetailExpense(newer, candidatesById)) return false;
	const purposes = new Set(rows.map(({category}) => category));
	if (purposes.size !== 1 || purposes.has(null)) return false;
	const oldPrice = parseCents(older.typicalAmount);
	const newPrice = parseCents(newer.typicalAmount);
	return nearAmount(newPrice, oldPrice);
}

/** One name is the other followed by more whole words, after the merchant-key normalization of legal forms. */
function continuesName(olderSeries: UndatedRecurringSeries, newerSeries: UndatedRecurringSeries): boolean {
	const older = normalizedPayeeName(olderSeries.name, olderSeries.direction);
	const newer = normalizedPayeeName(newerSeries.name, olderSeries.direction);
	if (!older || !newer || older === newer) return false;
	return older.startsWith(`${newer} `) || newer.startsWith(`${older} `);
}
