import {createHash} from 'node:crypto';

/**
 * The `enable-banking-transaction-v2` identity keys exactly as the migrations compute them. Stored keys hash these
 * values, so this copy never follows changes to the live identity code in `modules/banking`. It lives outside
 * `migrations/` because TypeORM instantiates every function exported from a file there as a migration.
 */

const IDENTITY_VERSION = 'enable-banking-transaction-v2';

/** A row as the migrations read it: dates through `to_char(..., 'YYYY-MM-DD')`, numerics as text. */
export type BankTransactionIdentityRowV2 = {
	id: string;
	bankAccountId: string;
	transactionDate: string | null;
	bookingDate: string | null;
	valueDate: string | null;
	amount: string;
	currency: string | null;
	creditDebitIndicator: string | null;
	stableIdentityKey: string | null;
	stableIdentityGroupKey: string | null;
};

export type BankTransactionIdentityUpdateV2 = {
	id: string;
	stableIdentityGroupKey: string;
	stableIdentityKey: string;
};

/** Selects the columns `assignIncompleteBankTransactionIdentityKeysV2` reads, in the shape it expects. */
export const BANK_TRANSACTION_IDENTITY_ROW_V2_COLUMNS = `id, "bankAccountId", "stableIdentityKey", "stableIdentityGroupKey",
	to_char("transactionDate", 'YYYY-MM-DD') AS "transactionDate",
	to_char("bookingDate", 'YYYY-MM-DD') AS "bookingDate",
	to_char("valueDate", 'YYYY-MM-DD') AS "valueDate",
	amount::text AS amount, "currency", "creditDebitIndicator"`;

export function createBankTransactionStableIdentityGroupKeyV2(
	row: Pick<
		BankTransactionIdentityRowV2,
		| 'bankAccountId'
		| 'transactionDate'
		| 'bookingDate'
		| 'valueDate'
		| 'amount'
		| 'currency'
		| 'creditDebitIndicator'
	>,
): string {
	const identity = JSON.stringify([
		IDENTITY_VERSION,
		row.bankAccountId,
		[
			row.transactionDate ?? '',
			row.bookingDate ?? '',
			row.valueDate ?? '',
			normalizeAmount(row.amount),
			(row.currency ?? '').toUpperCase(),
			(row.creditDebitIndicator ?? '').toUpperCase(),
		],
	]);
	return createHash('sha256').update(identity).digest('hex');
}

export function createBankTransactionStableIdentityKeyV2(groupKey: string, occurrence: number): string {
	return createHash('sha256')
		.update(JSON.stringify([IDENTITY_VERSION, groupKey, occurrence]))
		.digest('hex');
}

/**
 * Completes the rows whose group key or key is missing or empty, keeping every stored value. A missing key takes the
 * lowest free occurrence of the row's group in its account, in the order of `rows` (callers sort by account, then id).
 */
export function assignIncompleteBankTransactionIdentityKeysV2(
	rows: readonly BankTransactionIdentityRowV2[],
): BankTransactionIdentityUpdateV2[] {
	const usedKeysByAccount = new Map<string, Set<string>>();
	const usedKeys = (bankAccountId: string): Set<string> => {
		let keys = usedKeysByAccount.get(bankAccountId);
		if (!keys) {
			keys = new Set();
			usedKeysByAccount.set(bankAccountId, keys);
		}
		return keys;
	};
	for (const row of rows) {
		if (row.stableIdentityKey) usedKeys(row.bankAccountId).add(row.stableIdentityKey);
	}

	const updates: BankTransactionIdentityUpdateV2[] = [];
	for (const row of rows) {
		if (row.stableIdentityKey && row.stableIdentityGroupKey) continue;
		const stableIdentityGroupKey = row.stableIdentityGroupKey || createBankTransactionStableIdentityGroupKeyV2(row);
		const accountKeys = usedKeys(row.bankAccountId);
		let stableIdentityKey = row.stableIdentityKey;
		for (let occurrence = 1; !stableIdentityKey; occurrence += 1) {
			const candidate = createBankTransactionStableIdentityKeyV2(stableIdentityGroupKey, occurrence);
			if (!accountKeys.has(candidate)) stableIdentityKey = candidate;
		}
		accountKeys.add(stableIdentityKey);
		updates.push({id: row.id, stableIdentityGroupKey, stableIdentityKey});
	}
	return updates;
}

function normalizeAmount(value: string): string {
	const normalized = value.trim();
	const match = normalized.match(/^([+-]?)(\d+)(?:\.(\d*))?$/);
	if (!match) return normalized.toLowerCase();

	const integer = match[2].replace(/^0+(?=\d)/, '');
	const fraction = (match[3] ?? '').replace(/0+$/, '');
	const isZero = integer === '0' && fraction.length === 0;
	const sign = !isZero && match[1] === '-' ? '-' : '';

	return `${sign}${integer}${fraction ? `.${fraction}` : ''}`;
}
