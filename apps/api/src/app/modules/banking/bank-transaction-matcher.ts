import {normalizeIdentityAmount} from './bank-transaction-identity';

/**
 * The duplicate ladder: decides which incoming rows (a statement file's, or a sync's) are already stored as
 * another row of the same account. Pure; amounts are signed decimal strings and dates `YYYY-MM-DD`.
 */

/** How many calendar days apart two rows may be for step 4, and how far around the incoming dates to look. */
export const MATCH_WINDOW_DAYS = 3;

/** `sameDayGroup`: paired inside a same-day look-alike group by `pairLookAlikeGroups`. */
export type MatchStep = 'reference' | 'balance' | 'sameDay' | 'nearby' | 'sameDayGroup';

export type MatchIncomingRow = {
	/** The row's counterparty and description, read only to order the pairs of a look-alike group. */
	text?: string | null;
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
	/**
	 * Its reference is in the incoming rows' own numbering (at an import: a row an earlier import stored), so the
	 * reference fallback keeps it. Rows without it are in the other source's numbering.
	 */
	sameNumbering?: boolean;
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

/**
 * How many rows must be probed (`probeReferences`) before the incoming references count as unrelated to the other
 * source's. A chosen value, not a measured one: enough rows that two sources sharing references have shown at least
 * one of them.
 */
export const REFERENCE_FALLBACK_MIN_PROBED_ROWS = 20;

/**
 * The same, between two statement formats on an imported-files account the statement's IBAN names: both sides are
 * the owner's files of that one account, so fewer rows show whether they share a numbering. Chosen, not measured.
 */
export const REFERENCE_FALLBACK_MIN_PROBED_ROWS_BETWEEN_FILES = 5;

export type ReferenceProbe = {
	/**
	 * Incoming rows with a reference that have at least one existing row in the other source's numbering (not
	 * `sameNumbering`) with the same amount and currency at most `MATCH_WINDOW_DAYS` away that carries a reference
	 * too: rows whose twin, if stored, could show whether the two sources share references.
	 */
	probedRows: number;
	/** Incoming rows whose reference equals the reference of any existing row in the other source's numbering. */
	rowsWithStoredReference: number;
};

/** What the incoming rows' references have in common with the other source's (references compared trimmed). */
export function probeReferences(
	incoming: readonly MatchIncomingRow[],
	existing: readonly MatchExistingRow[],
): ReferenceProbe {
	const others = existing.filter((row) => !row.sameNumbering && row.reference?.trim());
	const storedReferences = new Set(others.map(({reference}) => reference!.trim()));
	const referencedByAmount = groupBy(
		others.filter((row) => matchDay(row)),
		amountKey,
	);
	let probedRows = 0;
	let rowsWithStoredReference = 0;
	for (const row of incoming) {
		const reference = row.reference?.trim();
		if (!reference) continue;
		if (storedReferences.has(reference)) rowsWithStoredReference += 1;
		const day = matchDay(row);
		const lookAlikes = referencedByAmount.get(amountKey(row)) ?? [];
		if (day && lookAlikes.some((other) => daysBetween(day, matchDay(other)!) <= MATCH_WINDOW_DAYS)) probedRows += 1;
	}
	return {probedRows, rowsWithStoredReference};
}

export type ReferenceFallbackMatch = {outcomes: MatchOutcome[]; referencesSetAside: boolean};

export type ReferenceFallbackOptions = MatchOptions & {
	/** Pair same-day look-alike groups as large on both sides (`pairLookAlikeGroups`) after the ladder. */
	pairLookAlikeGroups?: boolean;
	/** Rows to probe before references are set aside; `REFERENCE_FALLBACK_MIN_PROBED_ROWS` by default. */
	minProbedRows?: number;
};

/**
 * The ladder between two sources that may number payments in different schemes: a statement file against what bank
 * sync stored, a sync's rows against imported ones, or one statement format against another's imported rows. When at
 * least `minProbedRows` (`REFERENCE_FALLBACK_MIN_PROBED_ROWS` by default) rows were
 * probed and none of the incoming references is one the other source stored, the other source's references are set
 * aside and the ladder runs with `uniqueCandidatesOnly`: rows then match by balance or date, and same-day look-alike
 * groups are held as doubtful rather than paired in order. Rows marked `sameNumbering` keep their references, so
 * they still match or conflict. Otherwise the ladder runs with the given options.
 */
export function matchWithReferenceFallback(
	incoming: readonly MatchIncomingRow[],
	existing: readonly MatchExistingRow[],
	{
		pairLookAlikeGroups: pairGroups = false,
		minProbedRows = REFERENCE_FALLBACK_MIN_PROBED_ROWS,
		...options
	}: ReferenceFallbackOptions = {},
): ReferenceFallbackMatch {
	const {probedRows, rowsWithStoredReference} = probeReferences(incoming, existing);
	const referencesSetAside = probedRows >= minProbedRows && rowsWithStoredReference === 0;
	const compared = referencesSetAside
		? existing.map((row) => (row.sameNumbering ? row : {...row, reference: null}))
		: existing;
	const outcomes = matchTransactions(incoming, compared, referencesSetAside ? {uniqueCandidatesOnly: true} : options);
	return {
		outcomes: pairGroups ? pairLookAlikeGroups(incoming, compared, outcomes) : outcomes,
		referencesSetAside,
	};
}

/**
 * Pairs what the ladder left doubtful inside same-day look-alike groups: when the doubtful incoming rows and the
 * unclaimed existing rows with one amount, currency and day are equally many and no two of them have
 * conflicting references, they are taken as the same payments. Pairs go most similar `text` first (the share of
 * words in common, case folded), then in incoming order against existing rows by
 * `createdAt` and `id`. Two indistinguishable rows may swap; nothing is added or lost. Other outcomes are returned
 * as they were.
 */
export function pairLookAlikeGroups(
	incoming: readonly MatchIncomingRow[],
	existing: readonly MatchExistingRow[],
	outcomes: readonly MatchOutcome[],
): MatchOutcome[] {
	const paired = [...outcomes];
	const claimed = new Set(outcomes.flatMap((outcome) => (outcome.kind === 'matched' ? [outcome.existingId] : [])));
	const ordered = [...existing].sort(
		(left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id),
	);
	const existingByDay = groupBy(
		ordered.filter((row) => !claimed.has(row.id) && matchDay(row)),
		dayKey,
	);
	const doubtfulByDay = groupBy(
		incoming.flatMap((row, index) => (outcomes[index].kind === 'doubtful' && matchDay(row) ? [index] : [])),
		(index) => dayKey(incoming[index]),
	);
	for (const [key, indexes] of doubtfulByDay) {
		const group = existingByDay.get(key) ?? [];
		if (group.length !== indexes.length) continue;
		if (indexes.some((index) => group.some((row) => referencesConflict(incoming[index], row)))) continue;
		const pairs = indexes
			.flatMap((index, position) =>
				group.map((row, rank) => ({
					index,
					position,
					row,
					rank,
					score: textSimilarity(incoming[index].text, row.text),
				})),
			)
			.sort(
				(left, right) => right.score - left.score || left.position - right.position || left.rank - right.rank,
			);
		const taken = new Set<string>();
		const done = new Set<number>();
		for (const {index, row} of pairs) {
			if (done.has(index) || taken.has(row.id)) continue;
			done.add(index);
			taken.add(row.id);
			paired[index] = {kind: 'matched', existingId: row.id, step: 'sameDayGroup'};
		}
	}
	return paired;
}

/** The share of words two texts have in common, case folded; 0 when either has none. */
function textSimilarity(left: string | null | undefined, right: string | null | undefined): number {
	const [leftWords, rightWords] = [words(left), words(right)];
	const shared = [...leftWords].filter((word) => rightWords.has(word)).length;
	return shared / (leftWords.size + rightWords.size - shared || 1);
}

function words(text: string | null | undefined): Set<string> {
	return new Set(
		(text ?? '')
			.toLowerCase()
			.split(/[^\p{L}\p{N}]+/u)
			.filter(Boolean),
	);
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
