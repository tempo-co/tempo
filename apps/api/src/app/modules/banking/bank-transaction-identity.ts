import {createHash} from 'node:crypto';

import type {BankTransaction} from './bank-transaction.entity';

export type BankTransactionIdentityInput = Pick<
	BankTransaction,
	| 'bankAccountId'
	| 'entryReference'
	| 'transactionDate'
	| 'bookingDate'
	| 'valueDate'
	| 'amount'
	| 'currency'
	| 'creditDebitIndicator'
	| 'bankTransactionCode'
	| 'bankTransactionSubCode'
	| 'bankTransactionDescription'
	| 'description'
	| 'counterpartyName'
	| 'merchantLocation'
	| 'merchantCategoryCode'
	| 'remittanceInformation'
	| 'instructedAmount'
	| 'instructedCurrency'
	| 'exchangeRate'
	| 'exchangeRateUnitCurrency'
	| 'exchangeRateType'
	| 'referenceNumber'
	| 'referenceNumberScheme'
> &
	Partial<Pick<BankTransaction, 'transactionStatus' | 'bookingDateFilled' | 'valueDateFilled'>>;

export type BankTransactionStableIdentityFields = {
	stableIdentityGroupKey: string;
	stableIdentityKey: string;
};

export type BankTransactionStoredStableIdentityFields = {
	stableIdentityGroupKey: string | null;
	stableIdentityKey: string | null;
};

const BANK_TRANSACTION_IDENTITY_VERSION = 'enable-banking-transaction-v2';
export const LEGACY_BANK_TRANSACTION_DEDUPE_KEY_PATTERN = '^[a-f0-9]{64}$';
const LEGACY_BANK_TRANSACTION_DEDUPE_KEY_REGEX = new RegExp(LEGACY_BANK_TRANSACTION_DEDUPE_KEY_PATTERN);

function createBankTransactionCoreFingerprint(transaction: BankTransactionIdentityInput): string[] {
	// Stored group keys hash these exact values, so their normalization must not change.
	return [
		normalizeIdentityDate(transaction.transactionDate),
		normalizeIdentityDate(transaction.bookingDate),
		normalizeIdentityDate(transaction.valueDate),
		normalizeIdentityAmount(transaction.amount),
		(transaction.currency ?? '').toUpperCase(),
		(transaction.creditDebitIndicator ?? '').toUpperCase(),
	];
}

function createBankTransactionContentFingerprint(transaction: BankTransactionIdentityInput): unknown[] {
	return [
		normalizeIdentityText(transaction.entryReference),
		normalizeIdentityText(transaction.bankTransactionCode),
		normalizeIdentityText(transaction.bankTransactionSubCode),
		normalizeIdentityText(transaction.bankTransactionDescription),
		normalizeIdentityText(transaction.description),
		normalizeIdentityText(transaction.counterpartyName),
		[
			normalizeIdentityText(transaction.merchantLocation?.city ?? null),
			normalizeIdentityText(transaction.merchantLocation?.region ?? null),
			normalizeIdentityText(transaction.merchantLocation?.country ?? null).toUpperCase(),
		],
		normalizeIdentityText(transaction.merchantCategoryCode),
		normalizeIdentityText(transaction.remittanceInformation),
		normalizeOptionalIdentityAmount(transaction.instructedAmount),
		normalizeIdentityText(transaction.instructedCurrency).toUpperCase(),
		normalizeOptionalIdentityAmount(transaction.exchangeRate),
		normalizeIdentityText(transaction.exchangeRateUnitCurrency).toUpperCase(),
		normalizeIdentityText(transaction.exchangeRateType).toUpperCase(),
		normalizeIdentityText(transaction.referenceNumber),
		normalizeIdentityText(transaction.referenceNumberScheme),
	];
}

export function createBankTransactionStableIdentityGroupKey(transaction: BankTransactionIdentityInput): string {
	const identity = JSON.stringify([
		BANK_TRANSACTION_IDENTITY_VERSION,
		transaction.bankAccountId,
		createBankTransactionCoreFingerprint(transaction),
	]);
	return createHash('sha256').update(identity).digest('hex');
}

export function createBankTransactionStableIdentityKey(
	transaction: BankTransactionIdentityInput,
	occurrence: number,
): string {
	return createBankTransactionStableIdentityKeyForGroup(
		createBankTransactionStableIdentityGroupKey(transaction),
		occurrence,
	);
}

export function createBankTransactionStableIdentityKeyForGroup(groupKey: string, occurrence: number): string {
	const identity = JSON.stringify([BANK_TRANSACTION_IDENTITY_VERSION, groupKey, occurrence]);
	return createHash('sha256').update(identity).digest('hex');
}

export function allocateNextBankTransactionStableIdentityKey(
	groupKey: string,
	usedKeys: ReadonlySet<string>,
	startingOccurrence = 1,
): {stableIdentityKey: string; nextOccurrence: number} {
	let occurrence = startingOccurrence;
	while (true) {
		const stableIdentityKey = createBankTransactionStableIdentityKeyForGroup(groupKey, occurrence);
		if (!usedKeys.has(stableIdentityKey)) return {stableIdentityKey, nextOccurrence: occurrence + 1};
		occurrence += 1;
	}
}

export function isLegacyBankTransactionDedupeKey(value: string | null | undefined): boolean {
	return typeof value === 'string' && LEGACY_BANK_TRANSACTION_DEDUPE_KEY_REGEX.test(value);
}

export function assignBankTransactionStableIdentityKeys<T extends BankTransactionIdentityInput>(
	transactions: T[],
	existingTransactions: Array<BankTransactionIdentityInput & BankTransactionStoredStableIdentityFields> = [],
	occupiedIdentityKeys: ReadonlySet<string> = new Set(),
): Array<T & BankTransactionStableIdentityFields> {
	const incomingByGroup = new Map<string, Array<{index: number; transaction: T; contentKey: string}>>();
	for (const [index, transaction] of transactions.entries()) {
		const groupKey = createBankTransactionStableIdentityGroupKey(transaction);
		const group = incomingByGroup.get(groupKey) ?? [];
		group.push({
			index,
			transaction,
			contentKey: JSON.stringify(createBankTransactionContentFingerprint(transaction)),
		});
		incomingByGroup.set(groupKey, group);
	}

	const existingByGroup = new Map<
		string,
		Array<BankTransactionIdentityInput & BankTransactionStableIdentityFields>
	>();
	for (const transaction of existingTransactions) {
		if (!transaction.stableIdentityKey || !transaction.stableIdentityGroupKey) continue;
		const groupKey = transaction.stableIdentityGroupKey;
		const group = existingByGroup.get(groupKey) ?? [];
		group.push({
			...transaction,
			stableIdentityGroupKey: groupKey,
			stableIdentityKey: transaction.stableIdentityKey,
		});
		existingByGroup.set(groupKey, group);
	}

	const assignments = new Map<number, BankTransactionStableIdentityFields>();
	// Booking can set or change both dates, so a pending row is looked up without them; `canBookPendingRow` then
	// compares the dates the provider actually sent for the pending row.
	const transitionKey = (transaction: BankTransactionIdentityInput) =>
		JSON.stringify([
			transaction.bankAccountId,
			createBankTransactionCoreFingerprint({...transaction, bookingDate: null, valueDate: null}),
			createBankTransactionContentFingerprint(transaction),
		]);
	const incomingByTransition = new Map<string, number[]>();
	const existingByTransition = new Map<string, typeof existingTransactions>();
	for (const [index, transaction] of transactions.entries()) {
		const key = transitionKey(transaction);
		const group = incomingByTransition.get(key) ?? [];
		group.push(index);
		incomingByTransition.set(key, group);
	}
	for (const transaction of existingTransactions) {
		const key = transitionKey(transaction);
		const group = existingByTransition.get(key) ?? [];
		group.push(transaction);
		existingByTransition.set(key, group);
	}
	const incomingReferences = new Set(
		transactions.map(({entryReference}) => normalizeReference(entryReference)).filter(Boolean),
	);
	const reusedKeys = new Set<string>();
	for (const [key, indexes] of incomingByTransition) {
		const candidates = existingByTransition.get(key) ?? [];
		if (indexes.length !== 1 || candidates.length !== 1) continue;
		const incoming = transactions[indexes[0]];
		const existing = candidates[0];
		if (!canBookPendingRow(existing, incoming) || !existing.stableIdentityKey || !existing.stableIdentityGroupKey)
			continue;
		assignments.set(indexes[0], {
			stableIdentityGroupKey: createBankTransactionStableIdentityGroupKey(incoming),
			stableIdentityKey: existing.stableIdentityKey,
		});
		reusedKeys.add(existing.stableIdentityKey);
	}
	const reservedKeys = new Set([
		...occupiedIdentityKeys,
		...existingTransactions.flatMap(({stableIdentityKey}) => (stableIdentityKey ? [stableIdentityKey] : [])),
	]);
	const usedKeys = new Set(reservedKeys);
	for (const [groupKey, incomingGroup] of incomingByGroup) {
		const existingGroup = [...(existingByGroup.get(groupKey) ?? [])].sort((left, right) =>
			left.stableIdentityKey.localeCompare(right.stableIdentityKey),
		);
		const unmatchedExisting = new Set(
			existingGroup.filter(({stableIdentityKey}) => !reusedKeys.has(stableIdentityKey)),
		);
		const existingContentKeys = new Map(
			existingGroup.map((existing) => [
				existing,
				JSON.stringify(createBankTransactionContentFingerprint(existing)),
			]),
		);
		const incomingByContent = [...incomingGroup].sort((left, right) => {
			if (left.contentKey < right.contentKey) return -1;
			if (left.contentKey > right.contentKey) return 1;
			return left.index - right.index;
		});
		const unmatchedIncoming: typeof incomingByContent = [];

		for (const incoming of incomingByContent) {
			if (assignments.has(incoming.index)) continue;
			const matchingExisting = existingGroup.find(
				(existing) =>
					unmatchedExisting.has(existing) && existingContentKeys.get(existing) === incoming.contentKey,
			);
			if (matchingExisting) {
				unmatchedExisting.delete(matchingExisting);
				assignments.set(incoming.index, {
					stableIdentityGroupKey: groupKey,
					stableIdentityKey: matchingExisting.stableIdentityKey,
				});
			} else {
				unmatchedIncoming.push(incoming);
			}
		}

		// The same number of stored and new rows left over means the provider edited their details: pair them.
		const pairedIncoming =
			unmatchedIncoming.length === unmatchedExisting.size
				? pairEditedRows([...unmatchedExisting], unmatchedIncoming, incomingReferences)
				: new Map<number, string>();
		for (const [index, stableIdentityKey] of pairedIncoming) {
			assignments.set(index, {stableIdentityGroupKey: groupKey, stableIdentityKey});
		}

		let nextOccurrence = 1;
		for (const incoming of unmatchedIncoming.filter(({index}) => !pairedIncoming.has(index))) {
			const allocation = allocateNextBankTransactionStableIdentityKey(groupKey, usedKeys, nextOccurrence);
			nextOccurrence = allocation.nextOccurrence;
			assignments.set(incoming.index, {
				stableIdentityGroupKey: groupKey,
				stableIdentityKey: allocation.stableIdentityKey,
			});
			usedKeys.add(allocation.stableIdentityKey);
		}
	}

	return transactions.map((transaction, index) => ({
		...transaction,
		...assignments.get(index)!,
	}));
}

/**
 * A booked row continues a stored pending row with the same reference and content. A date the provider sent for the
 * pending row must stay the same; a date the client filled in from `transactionDate` says nothing.
 */
function canBookPendingRow(existing: BankTransactionIdentityInput, incoming: BankTransactionIdentityInput): boolean {
	const keepsDate = (field: 'bookingDate' | 'valueDate', filled: boolean | undefined) =>
		filled === true ||
		normalizeIdentityDate(existing[field]) === '' ||
		normalizeIdentityDate(existing[field]) === normalizeIdentityDate(incoming[field]);
	return (
		incoming.transactionStatus === 'BOOK' &&
		existing.transactionStatus === 'PDNG' &&
		normalizeReference(incoming.entryReference).length > 0 &&
		normalizeIdentityDate(incoming.valueDate) !== '' &&
		keepsDate('bookingDate', existing.bookingDateFilled) &&
		keepsDate('valueDate', existing.valueDateFilled)
	);
}

/**
 * Pairs stored rows with the new rows of the same group whose details changed, most equal details first, then in
 * key and content order so every sync pairs the same way. A booked row never turns back into a pending one, and a
 * stored entry reference that this fetch still sends belongs to that row, not to one with another reference.
 */
function pairEditedRows(
	existingRows: Array<BankTransactionIdentityInput & BankTransactionStableIdentityFields>,
	incomingRows: Array<{index: number; transaction: BankTransactionIdentityInput; contentKey: string}>,
	incomingReferences: ReadonlySet<string>,
): Map<number, string> {
	const candidates = existingRows.flatMap((existing) => {
		const existingContent = createBankTransactionContentFingerprint(existing);
		const existingReference = normalizeReference(existing.entryReference);
		return incomingRows.flatMap((incoming) => {
			const incomingReference = normalizeReference(incoming.transaction.entryReference);
			if (
				(existing.transactionStatus === 'BOOK' && incoming.transaction.transactionStatus === 'PDNG') ||
				(existingReference &&
					incomingReference &&
					existingReference !== incomingReference &&
					incomingReferences.has(existingReference))
			)
				return [];
			const incomingContent = createBankTransactionContentFingerprint(incoming.transaction);
			const equalDetails = existingContent.filter(
				(value, field) => JSON.stringify(value) === JSON.stringify(incomingContent[field]),
			).length;
			return [{existing, incoming, equalDetails}];
		});
	});
	candidates.sort(
		(left, right) =>
			right.equalDetails - left.equalDetails ||
			left.existing.stableIdentityKey.localeCompare(right.existing.stableIdentityKey) ||
			(left.incoming.contentKey < right.incoming.contentKey
				? -1
				: left.incoming.contentKey > right.incoming.contentKey
					? 1
					: left.incoming.index - right.incoming.index),
	);
	const paired = new Map<number, string>();
	const pairedKeys = new Set<string>();
	for (const {existing, incoming} of candidates) {
		if (paired.has(incoming.index) || pairedKeys.has(existing.stableIdentityKey)) continue;
		paired.set(incoming.index, existing.stableIdentityKey);
		pairedKeys.add(existing.stableIdentityKey);
	}
	return paired;
}

function normalizeReference(value: string | null | undefined): string {
	return value?.trim() ?? '';
}

/** Provider text as a person would compare it: surrounding and repeated whitespace and letter case don't count. */
function normalizeIdentityText(value: string | null): string {
	return (value ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeIdentityDate(value: string | Date | null): string {
	if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
	return value ?? '';
}

function normalizeOptionalIdentityAmount(value: string | null): string | null {
	return value === null ? null : normalizeIdentityAmount(value);
}

/** A decimal string in one canonical form, so `10.5` and `10.50` compare equal. */
export function normalizeIdentityAmount(value: string): string {
	const normalized = value.trim();
	const match = normalized.match(/^([+-]?)(\d+)(?:\.(\d*))?$/);
	if (!match) return normalized.toLowerCase();

	const integer = match[2].replace(/^0+(?=\d)/, '');
	const fraction = (match[3] ?? '').replace(/0+$/, '');
	const isZero = integer === '0' && fraction.length === 0;
	const sign = !isZero && match[1] === '-' ? '-' : '';

	return `${sign}${integer}${fraction ? `.${fraction}` : ''}`;
}
