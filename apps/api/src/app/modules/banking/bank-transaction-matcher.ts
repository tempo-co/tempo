import {normalizeIdentityAmount} from './bank-transaction-identity';

/**
 * The duplicate ladder: decides which incoming rows (a statement file's, or a sync's) are already stored as
 * another row of the same account. Pure; amounts are signed decimal strings and dates `YYYY-MM-DD`.
 */

/** How many calendar days apart two rows may be for step 4, and how far around the incoming dates to look. */
export const MATCH_WINDOW_DAYS = 3;

export type MatchStep = 'reference' | 'balance' | 'sameDay' | 'nearby';

export type MatchIncomingRow = {
	amount: string;
	currency: string;
	bookingDate: string | null;
	valueDate: string | null;
	balanceAfter: string | null;
	reference: string | null;
};

export type MatchExistingRow = MatchIncomingRow & {
	id: string;
	createdAt: Date;
};

export type MatchOutcome =
	{kind: 'matched'; existingId: string; step: MatchStep} | {kind: 'new'} | {kind: 'doubtful'; candidateIds: string[]};

export type MatchOptions = {
	/**
	 * Step 3 pairs a same-day group only when it holds one incoming and one existing row; larger groups go on to
	 * step 4, where they are doubtful. For callers that carry an existing row's own data over (sync adoption).
	 */
	uniqueCandidatesOnly?: boolean;
};

/** A row's day: its booking date, or its value date when it has none. */
export function matchDay(row: Pick<MatchIncomingRow, 'bookingDate' | 'valueDate'>): string | null {
	return row.bookingDate ?? row.valueDate;
}

/**
 * One outcome per incoming row, in input order. Each step runs over every still-unclaimed row before the next;
 * an existing row is claimed by at most one incoming row.
 *
 * 1. Reference: the incoming reference equals the reference of exactly one unclaimed existing row with the same
 *    amount and currency.
 * 2. Balance: exactly one unclaimed existing row with the same amount, currency, value date and balance after.
 * 3. Same day: rows with the same amount, currency and day pair off in order (incoming order; existing rows by
 *    `createdAt`, then `id`), unless `uniqueCandidatesOnly` is set and the group holds more than one either side.
 *    An incoming row skips existing rows whose reference conflicts with its own.
 * 4. Nearby: the only unclaimed existing row with the same amount and currency at most `MATCH_WINDOW_DAYS` away,
 *    when no other remaining incoming row has it as a candidate and its reference does not conflict. No candidate
 *    is new; anything else is doubtful.
 *
 * Two references conflict when both are non-empty after trimming and differ: the rows are different payments, so
 * steps 3 and 4 never pair them on their own. A row without a reference conflicts with nothing.
 */
export function matchTransactions(
	incoming: readonly MatchIncomingRow[],
	existing: readonly MatchExistingRow[],
	options: MatchOptions = {},
): MatchOutcome[] {
	const outcomes: Array<MatchOutcome | undefined> = incoming.map(() => undefined);
	const claimed = new Set<string>();
	const ordered = [...existing].sort(
		(left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id),
	);
	const byAmount = groupBy(ordered, amountKey);
	const unclaimed = (key: string) => (byAmount.get(key) ?? []).filter(({id}) => !claimed.has(id));
	const claim = (index: number, row: MatchExistingRow, step: MatchStep) => {
		claimed.add(row.id);
		outcomes[index] = {kind: 'matched', existingId: row.id, step};
	};
	const open = () => incoming.flatMap((row, index) => (outcomes[index] ? [] : [{row, index}]));

	for (const {row, index} of open()) {
		const reference = row.reference?.trim();
		if (!reference) continue;
		const candidates = unclaimed(amountKey(row)).filter((other) => other.reference?.trim() === reference);
		if (candidates.length === 1) claim(index, candidates[0], 'reference');
	}

	for (const {row, index} of open()) {
		if (!row.valueDate || row.balanceAfter === null) continue;
		const balance = normalizeIdentityAmount(row.balanceAfter);
		const candidates = unclaimed(amountKey(row)).filter(
			(other) =>
				other.valueDate === row.valueDate &&
				other.balanceAfter !== null &&
				normalizeIdentityAmount(other.balanceAfter) === balance,
		);
		if (candidates.length === 1) claim(index, candidates[0], 'balance');
	}

	const existingByDay = groupBy(
		ordered.filter((row) => !claimed.has(row.id) && matchDay(row)),
		dayKey,
	);
	const incomingByDay = groupBy(
		open().filter(({row}) => matchDay(row)),
		({row}) => dayKey(row),
	);
	for (const [key, group] of incomingByDay) {
		const existingGroup = existingByDay.get(key) ?? [];
		// Pairing look-alikes is only safe when the caller treats them as interchangeable.
		if (options.uniqueCandidatesOnly && (group.length > 1 || existingGroup.length > 1)) continue;
		for (const {row, index} of group) {
			const position = existingGroup.findIndex((other) => !referencesConflict(row, other));
			if (position >= 0) claim(index, existingGroup.splice(position, 1)[0], 'sameDay');
		}
	}

	const remaining = open();
	const candidatesByIndex = new Map(
		remaining.map(({row, index}) => {
			const day = matchDay(row);
			const candidates = day
				? unclaimed(amountKey(row)).filter((other) => {
						const otherDay = matchDay(other);
						return otherDay !== null && daysBetween(day, otherDay) <= MATCH_WINDOW_DAYS;
					})
				: [];
			return [index, candidates] as const;
		}),
	);
	const claimants = new Map<string, number>();
	for (const candidates of candidatesByIndex.values()) {
		for (const {id} of candidates) claimants.set(id, (claimants.get(id) ?? 0) + 1);
	}
	for (const [index, candidates] of candidatesByIndex) {
		const [only] = candidates;
		if (!only) outcomes[index] = {kind: 'new'};
		else if (candidates.length === 1 && claimants.get(only.id) === 1 && !referencesConflict(incoming[index], only))
			outcomes[index] = {kind: 'matched', existingId: only.id, step: 'nearby'};
		else outcomes[index] = {kind: 'doubtful', candidateIds: candidates.map(({id}) => id)};
	}

	return outcomes as MatchOutcome[];
}

function referencesConflict(left: MatchIncomingRow, right: MatchIncomingRow): boolean {
	const [one, other] = [left.reference?.trim(), right.reference?.trim()];
	return !!one && !!other && one !== other;
}

function amountKey(row: Pick<MatchIncomingRow, 'amount' | 'currency'>): string {
	return JSON.stringify([normalizeIdentityAmount(row.amount), row.currency.trim().toUpperCase()]);
}

function dayKey(row: MatchIncomingRow): string {
	return JSON.stringify([amountKey(row), matchDay(row)]);
}

function daysBetween(left: string, right: string): number {
	return Math.abs(Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`)) / 86_400_000;
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
	const groups = new Map<string, T[]>();
	for (const row of rows) {
		const group = groups.get(key(row)) ?? [];
		group.push(row);
		groups.set(key(row), group);
	}
	return groups;
}
