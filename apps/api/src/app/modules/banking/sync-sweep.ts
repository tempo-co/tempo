import {normalizeIdentityAmount} from './bank-transaction-identity';
import {MATCH_WINDOW_DAYS, matchDay} from './bank-transaction-matcher';

/** A row as the sweep compares it: a removed imported row, or a row sync stored that its edits could move to. */
export type CarryRow = {
	id: string;
	amount: string;
	currency: string;
	bookingDate: string | null;
	valueDate: string | null;
	/** Counterparty and description, as the duplicate ladder reads them. */
	text: string | null;
};

/**
 * Where each removed imported row's manual category and own-transfer choice go: a row of `pool` with the same amount
 * and currency within `MATCH_WINDOW_DAYS` days that no other removed row went to. The rows go day by day in the order
 * they come (the caller sorts them by day), so a file that dates every payment a day or two from sync keeps each
 * row's edits on its own twin. Within one day the best pairs go first: the same day, then the fewest days apart, then
 * the most similar text, then the removed row that comes first, then the lowest id. Null where none is left. The
 * caller leaves out of `pool` the rows that took over an imported row in this sync.
 */
export function pickCarryTargets(removed: readonly CarryRow[], pool: readonly CarryRow[]): Map<string, string | null> {
	const targets = new Map<string, string | null>(removed.map(({id}) => [id, null]));
	const taken = new Set<string>();
	const days: Array<{day: string; rows: Array<{row: CarryRow; order: number}>}> = [];
	for (const [order, row] of removed.entries()) {
		const day = matchDay(row);
		if (!day) continue;
		if (days.at(-1)?.day !== day) days.push({day, rows: []});
		days.at(-1)!.rows.push({row, order});
	}
	for (const {day, rows} of days) {
		const pairs = rows.flatMap(({row, order}) =>
			pool.flatMap((other) => {
				const otherDay = matchDay(other);
				if (!otherDay || taken.has(other.id) || amountKey(other) !== amountKey(row)) return [];
				const apart = daysApart(day, otherDay);
				return apart <= MATCH_WINDOW_DAYS
					? [{row: row.id, order, target: other.id, apart, score: similarity(row.text, other.text)}]
					: [];
			}),
		);
		pairs.sort(
			(left, right) =>
				left.apart - right.apart ||
				right.score - left.score ||
				left.order - right.order ||
				left.target.localeCompare(right.target),
		);
		for (const pair of pairs) {
			if (targets.get(pair.row) !== null || taken.has(pair.target)) continue;
			targets.set(pair.row, pair.target);
			taken.add(pair.target);
		}
	}
	return targets;
}

function amountKey({amount, currency}: CarryRow): string {
	return `${normalizeIdentityAmount(amount)}|${currency.trim().toUpperCase()}`;
}

function daysApart(left: string, right: string): number {
	return Math.abs(Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`)) / 86_400_000;
}

/** Shared words over all words of both texts, without case or punctuation. */
function similarity(left: string | null, right: string | null): number {
	const [a, b] = [words(left), words(right)];
	const shared = [...a].filter((word) => b.has(word)).length;
	return shared / (a.size + b.size - shared || 1);
}

function words(text: string | null): Set<string> {
	return new Set(
		(text ?? '')
			.toLowerCase()
			.split(/[^\p{L}\p{N}]+/u)
			.filter(Boolean),
	);
}
