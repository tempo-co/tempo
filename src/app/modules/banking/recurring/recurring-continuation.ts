import {getBankTransactionMerchantKey} from '../categorization/bank-transaction-merchant-key';
import {
	type DetectedRecurringSeries,
	type RecurringCandidate,
	detectRecurringSeries,
	isPersonTransferCategory,
	withinAmountTolerance,
} from './recurring-series-detection';
import {isOrdinaryRetailExpense} from './recurring-series-eligibility';

/** Two successive histories that may be one obligation; only the owner can say whether they are. */
export type ContinuationPair = {
	older: DetectedRecurringSeries;
	newer: DetectedRecurringSeries;
	/** The detector's history for both together, as it would read once linked. */
	joined: DetectedRecurringSeries;
};

/**
 * Finds histories that look like one fixed-price obligation renamed: the newer starts after the older ends, either name
 * extends the other by whole words, and direction, currency, cadence, price and a single payment purpose agree. The
 * detector must keep their union whole. Retail and person transfers are left out, and a history with more than one
 * possible counterpart is never paired. The same evidence also fits a new plan from the same provider, so a pair is
 * only ever a question for the owner.
 * A middle history of three successive renames has two counterparts, so it is asked about only once one link exists.
 */
export function joinContinuation(
	older: DetectedRecurringSeries,
	newer: DetectedRecurringSeries,
	candidatesById: ReadonlyMap<string, RecurringCandidate>,
	today: string,
	identityKey: string,
): DetectedRecurringSeries | null {
	const ids = new Set([...older.transactionIds, ...newer.transactionIds]);
	const rows = [...ids].map((id) => ({...candidatesById.get(id)!, recurringPayeeKey: identityKey}));
	const joined = detectRecurringSeries(rows, today);
	if (joined.length !== 1 || joined[0].transactionIds.length !== ids.size) return null;
	return joined[0];
}

export function findContinuationPairs(
	series: readonly DetectedRecurringSeries[],
	candidatesById: ReadonlyMap<string, RecurringCandidate>,
	today: string,
): ContinuationPair[] {
	const pairs: ContinuationPair[] = [];
	for (const older of series) {
		for (const newer of series) {
			if (older === newer || older.lastDate >= newer.firstDate) continue;
			if (!compatible(older, newer, candidatesById) || !continuesName(older.name, newer.name, older.direction))
				continue;
			const joined = joinContinuation(older, newer, candidatesById, today, continuationKey(older, newer));
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

/** The identity a pair's payments are replayed under; it never reaches stored data. */
export function continuationKey(older: DetectedRecurringSeries, newer: DetectedRecurringSeries): string {
	return `${older.direction}:continuation:${older.key}:${newer.key}`;
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
	const oldPrice = cents(older.typicalAmount);
	const newPrice = cents(newer.typicalAmount);
	return withinAmountTolerance(oldPrice > newPrice ? oldPrice - newPrice : newPrice - oldPrice, oldPrice);
}

/** One name is the other followed by more whole words, after the merchant-key normalization of legal forms. */
function continuesName(olderName: string, newerName: string, direction: string): boolean {
	const older = normalizedName(olderName, direction);
	const newer = normalizedName(newerName, direction);
	if (!older || !newer || older === newer) return false;
	return older.startsWith(`${newer} `) || newer.startsWith(`${older} `);
}

function normalizedName(name: string, direction: string): string | null {
	const key = getBankTransactionMerchantKey({
		counterpartyName: name,
		creditDebitIndicator: direction === 'EXPENSE' ? 'DBIT' : 'CRDT',
	});
	if (!key) return null;
	return key
		.slice(key.indexOf(':') + 1)
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/\s+/g, ' ')
		.trim();
}

function cents(amount: string): bigint {
	return BigInt(amount.replace('.', ''));
}
