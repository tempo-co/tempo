import {EnableBankingBalance} from './enable-banking.types';

const AVAILABLE_BALANCE_PREFERENCE = 2;
const BOOKED_BALANCE_PREFERENCE = 1;
const UNKNOWN_BALANCE_PREFERENCE = 0;

const BALANCE_PREFERENCES: Readonly<Record<string, number>> = {
	AVAILABLE: AVAILABLE_BALANCE_PREFERENCE,
	AVAILABLEBALANCE: AVAILABLE_BALANCE_PREFERENCE,
	CLAV: AVAILABLE_BALANCE_PREFERENCE,
	CLOSINGAVAILABLE: AVAILABLE_BALANCE_PREFERENCE,
	FORWARDAVAILABLE: AVAILABLE_BALANCE_PREFERENCE,
	FWAV: AVAILABLE_BALANCE_PREFERENCE,
	INTERIMAVAILABLE: AVAILABLE_BALANCE_PREFERENCE,
	ITAV: AVAILABLE_BALANCE_PREFERENCE,
	OPAV: AVAILABLE_BALANCE_PREFERENCE,
	OPENINGAVAILABLE: AVAILABLE_BALANCE_PREFERENCE,
	BOOKED: BOOKED_BALANCE_PREFERENCE,
	BOOKEDBALANCE: BOOKED_BALANCE_PREFERENCE,
	CLBD: BOOKED_BALANCE_PREFERENCE,
	CLOSINGBOOKED: BOOKED_BALANCE_PREFERENCE,
	INTERIMBOOKED: BOOKED_BALANCE_PREFERENCE,
	ITBD: BOOKED_BALANCE_PREFERENCE,
	OPBD: BOOKED_BALANCE_PREFERENCE,
	OPENINGBOOKED: BOOKED_BALANCE_PREFERENCE,
	PRCD: BOOKED_BALANCE_PREFERENCE,
	INFO: UNKNOWN_BALANCE_PREFERENCE,
	OTHR: UNKNOWN_BALANCE_PREFERENCE,
	XPCD: UNKNOWN_BALANCE_PREFERENCE,
};

export function getBalancePreference(balanceType: string): number {
	const normalizedType = balanceType
		.trim()
		.toUpperCase()
		.replace(/[\s_-]+/g, '');
	const preference = BALANCE_PREFERENCES[normalizedType];
	return typeof preference === 'number' ? preference : UNKNOWN_BALANCE_PREFERENCE;
}

function compareDescending(left: string, right: string): number {
	if (left === right) return 0;
	return left > right ? -1 : 1;
}

function getBalanceTieBreaker(balance: EnableBankingBalance): string {
	return JSON.stringify([
		balance.balanceType,
		balance.amount,
		balance.currency,
		balance.name ?? '',
		balance.lastChangeDateTime ?? '',
		balance.referenceDate ?? '',
		balance.lastCommittedTransaction ?? '',
	]);
}

export function selectPreferredBalance(balances: EnableBankingBalance[]): EnableBankingBalance | undefined {
	return [...balances].sort((left, right) => {
		const preferenceDifference = getBalancePreference(right.balanceType) - getBalancePreference(left.balanceType);
		if (preferenceDifference !== 0) return preferenceDifference;

		const referenceDateDifference = compareDescending(left.referenceDate ?? '', right.referenceDate ?? '');
		if (referenceDateDifference !== 0) return referenceDateDifference;

		const lastChangeDifference = compareDescending(left.lastChangeDateTime ?? '', right.lastChangeDateTime ?? '');
		if (lastChangeDifference !== 0) return lastChangeDifference;

		return compareDescending(getBalanceTieBreaker(left), getBalanceTieBreaker(right));
	})[0];
}

/** Canonical currency and debit/credit codes at the provider persistence boundary. */
export function normalizeBankCode(value: string): string {
	return value.trim().toUpperCase();
}

export function truncate(value: string | null | undefined, length: number): string | null {
	return value ? value.slice(0, length) : null;
}

export function safeErrorName(error: unknown): string {
	return error instanceof Error && error.name.length > 0 ? error.name : 'UnknownError';
}

/** Shifts a `YYYY-MM-DD` date by whole calendar days. */
export function addDays(date: string, days: number): string {
	const value = new Date(`${date}T00:00:00.000Z`);
	value.setUTCDate(value.getUTCDate() + days);
	return value.toISOString().slice(0, 10);
}

const HOSTNAME_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** A lowercase DNS hostname ending in a letters-only label: no IP literal, port or trailing dot. */
export function isHostname(value: string): boolean {
	return HOSTNAME_PATTERN.test(value);
}

export const BATCH_WRITE_CHUNK_SIZE = 1000;

export function chunkArray<T>(items: readonly T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
	return chunks;
}

/**
 * Builds a parameterized Postgres `VALUES` list, e.g. `($1::uuid, $2::varchar), ($3::uuid, $4::varchar)`.
 * Every placeholder carries its column cast so the derived table has explicit types.
 */
export function buildPostgresValuesList(
	rows: readonly (readonly unknown[])[],
	casts: readonly string[],
): {sql: string; parameters: unknown[]} {
	const parameters: unknown[] = [];
	const sql = rows
		.map((row) => {
			const placeholders = casts.map((cast, column) => {
				parameters.push(row[column]);
				return `$${parameters.length}::${cast}`;
			});
			return `(${placeholders.join(', ')})`;
		})
		.join(', ');
	return {sql, parameters};
}
