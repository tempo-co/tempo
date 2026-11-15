import {MatchExistingRow, matchDay, matchTransactions} from '@modules/banking/bank-transaction-matcher';

import {amountScale, formatUnits, parseDecimal} from './parsers/decimal';
import {NormalizedRow, NormalizedStatement, StatementBalance} from './parsers/parse-result';

/**
 * Where one statement does not open at the balance the statement before it closed at: entries between them are
 * missing. `amount` is what they add up to (the opening minus the earlier closing), a signed decimal string.
 */
export type StatementGap = {from: string; to: string; amount: string};

/** Rows a later statement of the drop repeats, by the ladder step that found them. */
export type RepeatedRows = {reference: number; balance: number; date: number};

export type JoinedStatements = {
	/** Every statement's rows in order, without the rows an earlier statement of the drop already holds. */
	rows: NormalizedRow[];
	repeated: RepeatedRows;
	gaps: StatementGap[];
	/**
	 * The newest closing balance the statements state, dated the later of its own day and its statement's last
	 * booking day: a statement's closing balance includes every entry of it.
	 */
	closingBalance: StatementBalance | null;
};

/**
 * Joins the statements of one account in one format (one CSV layout), in drop order, as if each had been dropped
 * after the ones before it. A statement that opens at the previous one's closing balance follows on from it and is
 * taken whole, even where its first day is the other's last. Otherwise each of its rows runs the duplicate ladder
 * against the earlier statements' rows of the same day, and the ones it matches are left out. Rows of other days,
 * and look-alikes within one statement, are always kept. A statement that neither follows on from the one before it
 * nor repeats any earlier row, where both state the balances between them, is a gap.
 */
export function joinStatements(statements: readonly NormalizedStatement[]): JoinedStatements {
	const rows: NormalizedRow[] = [];
	const repeated: RepeatedRows = {reference: 0, balance: 0, date: 0};
	const gaps: StatementGap[] = [];
	let closingBalance: StatementBalance | null = null;
	let previous: NormalizedStatement | null = null;

	for (const statement of statements) {
		const followsOn =
			previous?.closingBalance != null &&
			statement.openingBalance !== null &&
			sameAmount(previous.closingBalance.amount, statement.openingBalance.amount);

		const kept = followsOn ? statement.rows : withoutRepeated(statement.rows, rows, repeated);
		rows.push(...kept);

		// A statement that repeats rows of an earlier one overlaps it, so it cannot open where the previous one closed.
		const overlaps = kept.length < statement.rows.length;
		if (previous?.closingBalance && statement.openingBalance && !followsOn && !overlaps) {
			const from = previous.closingBalance.date;
			gaps.push({
				from,
				to: statement.openingBalance.date > from ? statement.openingBalance.date : from,
				amount: difference(statement.openingBalance.amount, previous.closingBalance.amount),
			});
		}

		if (statement.closingBalance) {
			const last = lastDay(statement.rows);
			const date = last && last > statement.closingBalance.date ? last : statement.closingBalance.date;
			if (!closingBalance || date >= closingBalance.date) {
				closingBalance = {date, amount: statement.closingBalance.amount};
			}
		}
		previous = statement;
	}
	return {rows, repeated, gaps, closingBalance};
}

/** The statement's rows without those an earlier statement holds on the same day, counted into `repeated`. */
function withoutRepeated(
	incoming: readonly NormalizedRow[],
	earlier: readonly NormalizedRow[],
	repeated: RepeatedRows,
): NormalizedRow[] {
	const dropped = new Set<number>();
	const byDay = new Map<string, number[]>();
	for (const [index, row] of incoming.entries()) {
		const day = matchDay(row);
		if (day) byDay.set(day, [...(byDay.get(day) ?? []), index]);
	}
	for (const [day, indexes] of byDay) {
		const existing: MatchExistingRow[] = earlier.flatMap((row, position) =>
			matchDay(row) === day ? [{...toMatchRow(row), id: String(position), createdAt: new Date(position)}] : [],
		);
		if (existing.length === 0) continue;
		// One day at a time, so a row never matches an earlier statement's row of another day.
		const outcomes = matchTransactions(
			indexes.map((index) => toMatchRow(incoming[index])),
			existing,
		);
		for (const [position, outcome] of outcomes.entries()) {
			if (outcome.kind !== 'matched') continue;
			dropped.add(indexes[position]);
			if (outcome.step === 'reference') repeated.reference += 1;
			else if (outcome.step === 'balance') repeated.balance += 1;
			else repeated.date += 1;
		}
	}
	return incoming.filter((_row, index) => !dropped.has(index));
}

function toMatchRow(row: NormalizedRow) {
	return {
		amount: row.amount,
		currency: row.currency,
		bookingDate: row.bookingDate,
		valueDate: row.valueDate,
		balanceAfter: row.balanceAfter,
		reference: row.bankReference,
	};
}

/** The last day of the rows (booking date, else value date); null for a statement without rows. */
function lastDay(rows: readonly NormalizedRow[]): string | null {
	return rows.reduce<string | null>((last, row) => {
		const day = matchDay(row);
		return day && (!last || day > last) ? day : last;
	}, null);
}

function sameAmount(left: string, right: string): boolean {
	return parseDecimal(left, '.')!.units === parseDecimal(right, '.')!.units;
}

function difference(left: string, right: string): string {
	const [one, other] = [parseDecimal(left, '.')!, parseDecimal(right, '.')!];
	return formatUnits(one.units - other.units, amountScale(one, other));
}
