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
	Partial<Pick<BankTransaction, 'transactionStatus'>>;

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
	return [
		normalizeIdentityDate(transaction.transactionDate),
		normalizeIdentityDate(transaction.bookingDate),
		normalizeIdentityDate(transaction.valueDate),
		normalizeIdentityAmount(transaction.amount),
		normalizeIdentityText(transaction.currency).toUpperCase(),
		normalizeIdentityText(transaction.creditDebitIndicator).toUpperCase(),
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
	const transitionKey = (transaction: BankTransactionIdentityInput) =>
		JSON.stringify([
			transaction.bankAccountId,
			createBankTransactionCoreFingerprint({...transaction, valueDate: null}),
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
	const reusedKeys = new Set<string>();
	for (const [key, indexes] of incomingByTransition) {
		const candidates = existingByTransition.get(key) ?? [];
		if (indexes.length !== 1 || candidates.length !== 1) continue;
		const incoming = transactions[indexes[0]];
		const existing = candidates[0];
		// Enable Banking fills a missing value_date from transactionDate.
		const existingValueDateDiffersFromTransactionDate =
			existing.valueDate !== null &&
			normalizeIdentityDate(existing.valueDate) !== normalizeIdentityDate(existing.transactionDate);
		if (
			incoming.transactionStatus !== 'BOOK' ||
			existing.transactionStatus !== 'PDNG' ||
			!incoming.entryReference?.trim() ||
			existingValueDateDiffersFromTransactionDate ||
			!normalizeIdentityDate(incoming.valueDate) ||
			!existing.stableIdentityKey ||
			!existing.stableIdentityGroupKey
		)
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

		const unmatchedExistingRows = [...unmatchedExisting];
		if (
			unmatchedIncoming.length === 1 &&
			unmatchedExistingRows.length === 1 &&
			canMatchUniqueCoreCandidate(unmatchedExistingRows[0], unmatchedIncoming[0].transaction)
		) {
			assignments.set(unmatchedIncoming[0].index, {
				stableIdentityGroupKey: groupKey,
				stableIdentityKey: unmatchedExistingRows[0].stableIdentityKey,
			});
			unmatchedIncoming.length = 0;
		}

		let nextOccurrence = 1;
		for (const incoming of unmatchedIncoming) {
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

function canMatchUniqueCoreCandidate(
	existing: BankTransactionIdentityInput,
	incoming: BankTransactionIdentityInput,
): boolean {
	const existingReference = existing.entryReference?.trim() ? existing.entryReference : null;
	const incomingReference = incoming.entryReference?.trim() ? incoming.entryReference : null;
	return !existingReference || !incomingReference || existingReference === incomingReference;
}

function normalizeIdentityText(value: string | null): string {
	return value ?? '';
}

function normalizeIdentityDate(value: string | Date | null): string {
	if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
	return value ?? '';
}

function normalizeOptionalIdentityAmount(value: string | null): string | null {
	return value === null ? null : normalizeIdentityAmount(value);
}

function normalizeIdentityAmount(value: string): string {
	const normalized = value.trim();
	const match = normalized.match(/^([+-]?)(\d+)(?:\.(\d*))?$/);
	if (!match) return normalized.toLowerCase();

	const integer = match[2].replace(/^0+(?=\d)/, '');
	const fraction = (match[3] ?? '').replace(/0+$/, '');
	const isZero = integer === '0' && fraction.length === 0;
	const sign = !isZero && match[1] === '-' ? '-' : '';

	return `${sign}${integer}${fraction ? `.${fraction}` : ''}`;
}
