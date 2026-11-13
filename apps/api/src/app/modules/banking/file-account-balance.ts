/** How many booking days with stated balances are tried, newest first, before an account has no file anchor. */
export const FILE_ANCHOR_MAX_DAYS = 30;

/** Balances are compared and subtracted as integer units of 10^-8, the scale `bank_transactions` stores. */
const SCALE = 8;

/** A stored row of an imported-files account that states its balance after. Amounts are decimal strings. */
export type StatedBalanceRow = {bookingDate: string; amount: string; balanceAfter: string};

/** The balance the bank stated at the end of one booking day. `amount` is a decimal string at scale 8. */
export type FileAnchor = {date: string; amount: string};

/**
 * The newest booking day whose rows state its closing balance unambiguously, among the newest
 * `FILE_ANCHOR_MAX_DAYS` days that have such rows; null when none does.
 */
export function findFileAnchor(rows: readonly StatedBalanceRow[]): FileAnchor | null {
	const byDay = new Map<string, StatedBalanceRow[]>();
	for (const row of rows) {
		const day = byDay.get(row.bookingDate);
		if (day) day.push(row);
		else byDay.set(row.bookingDate, [row]);
	}
	const days = [...byDay.keys()].sort().reverse().slice(0, FILE_ANCHOR_MAX_DAYS);
	for (const date of days) {
		const closing = closingBalance(byDay.get(date)!);
		if (closing !== null) return {date, amount: formatUnits(closing)};
	}
	return null;
}

/**
 * The closing balance of one day's rows: every row's balance after, minus every row's balance before it (balance
 * after minus amount), as multisets. Exactly one value left is the closing balance. None left (the day's bookings
 * cancel out) or several (part of the day is missing) leaves the day ambiguous: null.
 */
export function closingBalance(rows: readonly Pick<StatedBalanceRow, 'amount' | 'balanceAfter'>[]): bigint | null {
	const left = new Map<bigint, number>();
	for (const row of rows) {
		const after = toUnits(row.balanceAfter);
		left.set(after, (left.get(after) ?? 0) + 1);
	}
	for (const row of rows) {
		const before = toUnits(row.balanceAfter) - toUnits(row.amount);
		const count = left.get(before);
		if (count === undefined) continue;
		if (count === 1) left.delete(before);
		else left.set(before, count - 1);
	}
	const [only, ...others] = [...left.entries()];
	return only && others.length === 0 && only[1] === 1 ? only[0] : null;
}

function toUnits(value: string): bigint {
	const [, sign, whole, fraction = ''] = /^([+-]?)(\d+)(?:\.(\d*))?$/.exec(value.trim()) ?? [];
	if (whole === undefined || fraction.length > SCALE) throw new RangeError('Not a decimal at scale 8');
	const units = BigInt(whole) * 10n ** BigInt(SCALE) + BigInt(fraction.padEnd(SCALE, '0'));
	return sign === '-' ? -units : units;
}

function formatUnits(units: bigint): string {
	const negative = units < 0n;
	const digits = (negative ? -units : units).toString().padStart(SCALE + 1, '0');
	return `${negative ? '-' : ''}${digits.slice(0, -SCALE)}.${digits.slice(-SCALE)}`;
}
