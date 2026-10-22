import {parseCents} from '../summary/bank-transaction-summary';
import {normalizedPayeeName} from './recurring-payee-identity';
import {
	type DetectedRecurringSeries,
	type RecurringCandidate,
	detectRecurringSeries,
	isPersonTransferCategory,
	nearAmount,
} from './recurring-series-detection';
import {isOrdinaryRetailExpense} from './recurring-series-eligibility';

/** Two successive histories of one obligation; they are joined unless the owner unlinks them. */
export type ContinuationPair = {
	older: DetectedRecurringSeries;
	newer: DetectedRecurringSeries;
	/** The detector's history for both together, as it would read once linked. */
	joined: DetectedRecurringSeries;
};

/** The detector's single history for both together, or null when it would not keep their union whole. */
export function joinContinuation(
	older: DetectedRecurringSeries,
	newer: DetectedRecurringSeries,
	candidatesById: ReadonlyMap<string, RecurringCandidate>,
	today: string,
): DetectedRecurringSeries | null {
	// The pair is replayed under its own identity, so its rows group together whatever their own payee keys.
	const recurringPayeeKey = `${older.direction}:continuation:${older.key}:${newer.key}`;
	const ids = new Set([...older.transactionIds, ...newer.transactionIds]);
	const rows = [...ids].map((id) => ({...candidatesById.get(id)!, recurringPayeeKey}));
	const joined = detectRecurringSeries(rows, today);
	if (joined.length !== 1 || joined[0].transactionIds.length !== ids.size) return null;
	return joined[0];
}

/**
 * Finds histories that look like one fixed-price obligation renamed: the newer starts after the older ends, either name
 * extends the other by whole words, and direction, currency, cadence, price and a single payment purpose agree. The
 * detector must keep their union whole. Retail and person transfers are left out, and a history with more than one
 * possible counterpart is never paired. The same evidence also fits a new plan from the same provider, so the owner
 * can unlink a pair.
 * A middle history of three successive renames has two counterparts, so it is asked about only once one link exists.
 */
export function findContinuationPairs(
	series: readonly DetectedRecurringSeries[],
	candidatesById: ReadonlyMap<string, RecurringCandidate>,
	today: string,
): ContinuationPair[] {
	const pairs: ContinuationPair[] = [];
	for (const older of series) {
		for (const newer of series) {
			if (older === newer || older.lastDate >= newer.firstDate) continue;
			if (!compatible(older, newer, candidatesById) || !continuesName(older, newer)) continue;
			const joined = joinContinuation(older, newer, candidatesById, today);
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

function compatible(
	older: DetectedRecurringSeries,
	newer: DetectedRecurringSeries,
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
	if (rows.some(isPersonTransferCategory)) return false;
	if (isOrdinaryRetailExpense(older, candidatesById) || isOrdinaryRetailExpense(newer, candidatesById)) return false;
	const purposes = new Set(rows.map(({category}) => category));
	if (purposes.size !== 1 || purposes.has(null)) return false;
	const oldPrice = parseCents(older.typicalAmount);
	const newPrice = parseCents(newer.typicalAmount);
	return nearAmount(newPrice, oldPrice);
}

/** One name is the other followed by more whole words, after the merchant-key normalization of legal forms. */
function continuesName(olderSeries: DetectedRecurringSeries, newerSeries: DetectedRecurringSeries): boolean {
	const older = normalizedPayeeName(olderSeries.name, olderSeries.direction);
	const newer = normalizedPayeeName(newerSeries.name, olderSeries.direction);
	if (!older || !newer || older === newer) return false;
	return older.startsWith(`${newer} `) || newer.startsWith(`${older} `);
}
