import {extractStructuredCounterpartyName, normalizeBankTransactionText} from '../bank-transaction-display';
import {BANK_TRANSACTION_TYPES} from '../bank-transaction-type';

export const OWN_TRANSFER_EVIDENCE = {
	IBAN: 'IBAN',
	NAME: 'NAME',
	MANUAL: 'MANUAL',
} as const;
export type OwnTransferEvidence = (typeof OWN_TRANSFER_EVIDENCE)[keyof typeof OWN_TRANSFER_EVIDENCE];

export const OWN_TRANSFER_OVERRIDES = {
	MARKED: 'MARKED',
	UNMARKED: 'UNMARKED',
} as const;
export type OwnTransferOverride = (typeof OWN_TRANSFER_OVERRIDES)[keyof typeof OWN_TRANSFER_OVERRIDES];

/** Maximum distance between the booking dates of two legs of the same transfer. */
export const OWN_TRANSFER_PAIR_WINDOW_DAYS = 5;

export type OwnTransferAccount = {
	id: string;
	aspspName: string;
	currency: string;
	iban: string | null;
	/** Account holder name as reported by the bank. */
	holderName: string | null;
};

export type OwnTransferTransaction = {
	id: string;
	bankAccountId: string;
	/** Signed decimal string. */
	amount: string;
	currency: string;
	/** ISO date (YYYY-MM-DD): booking date, else transaction date, else value date. */
	date: string | null;
	transactionStatus: string | null;
	transactionType: string | null;
	financialEventType: string | null;
	counterpartyIban: string | null;
	description: string | null;
	override: OwnTransferOverride | string | null;
};

export type OwnTransferResult = {
	evidence: OwnTransferEvidence;
	counterpartId: string | null;
};

type Leg = {
	transaction: OwnTransferTransaction;
	day: number;
	amountKey: string;
	sign: -1 | 1;
	ibanTargets: Set<string>;
	evidence: OwnTransferEvidence | null;
};

type PairCandidate = {gap: number; firstDay: number; low: Leg; high: Leg};

/** Forms of address that some banks put before the holder name. */
const SALUTATIONS = new Set([
	'MR',
	'MRS',
	'MS',
	'MISS',
	'DR',
	'HR',
	'DHR',
	'MW',
	'MEVR',
	'HERR',
	'FRAU',
	'MME',
	'MLLE',
]);
const REVOLUT_TRANSFER_NAME = /^(?:To|Payment from)\s+(.+)$/i;
const DAY_MS = 86_400_000;

/**
 * Recognizes money moving between one owner's accounts. Pure and deterministic: the same owner-scoped
 * accounts and transactions always produce the same result, independent of input order.
 *
 * A leg has evidence when its counterparty IBAN is another owned account in the same currency, when its
 * counterparty name is the account holder's name (never for card payments), or when the owner marked it.
 * Legs pair across accounts on the exact opposite amount in the same currency within the date window; the
 * second leg needs its own evidence unless the first leg's IBAN points at its account.
 */
export function detectOwnTransfers({
	accounts,
	transactions,
}: {
	accounts: OwnTransferAccount[];
	transactions: OwnTransferTransaction[];
}): Map<string, OwnTransferResult> {
	const accountsById = new Map(accounts.map((account) => [account.id, account]));
	const accountIdsByIban = new Map<string, string[]>();
	for (const account of accounts) {
		if (!account.iban) continue;
		const key = ibanKey(account.iban, account.currency);
		const accountIds = accountIdsByIban.get(key);
		if (accountIds) accountIds.push(account.id);
		else accountIdsByIban.set(key, [account.id]);
	}
	const holderKeys = createHolderKeys(accounts.map((account) => account.holderName));

	const legs: Leg[] = [];
	for (const transaction of transactions) {
		const account = accountsById.get(transaction.bankAccountId);
		if (!account || !isEligible(transaction)) continue;

		const amount = parseAmount(transaction.amount);
		const day = parseDay(transaction.date);
		const ibanTargets = new Set(
			transaction.counterpartyIban
				? (accountIdsByIban.get(ibanKey(transaction.counterpartyIban, transaction.currency)) ?? []).filter(
						(accountId) => accountId !== account.id,
					)
				: [],
		);
		const evidence = getEvidence(transaction, account, ibanTargets, holderKeys);
		legs.push({
			transaction,
			day: day ?? Number.NaN,
			amountKey: amount ? `${transaction.currency.toUpperCase()}:${amount.magnitude}` : '',
			sign: amount?.sign ?? 1,
			ibanTargets,
			evidence,
		});
	}

	const legsByAmount = new Map<string, Leg[]>();
	for (const leg of legs) {
		if (!leg.amountKey || Number.isNaN(leg.day)) continue;
		const bucket = legsByAmount.get(leg.amountKey);
		if (bucket) bucket.push(leg);
		else legsByAmount.set(leg.amountKey, [leg]);
	}

	const candidates: PairCandidate[] = [];
	for (const leg of legs) {
		if (!leg.evidence || !leg.amountKey || Number.isNaN(leg.day)) continue;
		for (const other of legsByAmount.get(leg.amountKey) ?? []) {
			if (other.sign === leg.sign) continue;
			if (other.transaction.bankAccountId === leg.transaction.bankAccountId) continue;
			const gap = Math.abs(other.day - leg.day);
			if (gap > OWN_TRANSFER_PAIR_WINDOW_DAYS) continue;
			if (leg.ibanTargets.size > 0 && !leg.ibanTargets.has(other.transaction.bankAccountId)) continue;
			if (other.ibanTargets.size > 0 && !other.ibanTargets.has(leg.transaction.bankAccountId)) continue;
			if (!other.evidence && !leg.ibanTargets.has(other.transaction.bankAccountId)) continue;

			const [low, high] = leg.transaction.id < other.transaction.id ? [leg, other] : [other, leg];
			candidates.push({gap, firstDay: Math.min(leg.day, other.day), low, high});
		}
	}
	candidates.sort(
		(a, b) =>
			a.gap - b.gap ||
			a.firstDay - b.firstDay ||
			compareIds(a.low.transaction.id, b.low.transaction.id) ||
			compareIds(a.high.transaction.id, b.high.transaction.id),
	);

	const results = new Map<string, OwnTransferResult>();
	for (const {low, high} of candidates) {
		if (results.has(low.transaction.id) || results.has(high.transaction.id)) continue;

		const evidence = getPairEvidence(low, high);
		results.set(low.transaction.id, {evidence, counterpartId: high.transaction.id});
		results.set(high.transaction.id, {evidence, counterpartId: low.transaction.id});
	}

	for (const leg of legs) {
		if (leg.evidence && !results.has(leg.transaction.id)) {
			results.set(leg.transaction.id, {evidence: leg.evidence, counterpartId: null});
		}
	}

	return results;
}

/**
 * The other party's name as the bank wrote it in the description. The provider's counterparty field is
 * not used: when the other side is missing it falls back to the account holder, which would make an
 * ordinary debit look like a transfer to oneself.
 */
export function resolveOwnTransferCounterpartyName({
	description,
	aspspName,
}: {
	description: string | null;
	aspspName: string;
}): string | null {
	const normalizedDescription = normalizeBankTransactionText(description);
	if (!normalizedDescription) return null;

	const structuredName = extractStructuredCounterpartyName(normalizedDescription);
	if (structuredName) return structuredName;

	if (aspspName.trim().toLowerCase() !== 'revolut') return null;
	return REVOLUT_TRANSFER_NAME.exec(normalizedDescription)?.[1]?.trim() || null;
}

function isEligible(transaction: OwnTransferTransaction): boolean {
	return (
		transaction.transactionStatus?.toUpperCase() !== 'PDNG' &&
		!transaction.financialEventType &&
		transaction.override !== OWN_TRANSFER_OVERRIDES.UNMARKED
	);
}

function getEvidence(
	transaction: OwnTransferTransaction,
	account: OwnTransferAccount,
	ibanTargets: Set<string>,
	holderKeys: Set<string>,
): OwnTransferEvidence | null {
	if (ibanTargets.size > 0) return OWN_TRANSFER_EVIDENCE.IBAN;

	if (transaction.transactionType !== BANK_TRANSACTION_TYPES.CARD_PAYMENT) {
		const counterpartyName = resolveOwnTransferCounterpartyName({
			description: transaction.description,
			aspspName: account.aspspName,
		});
		if (counterpartyName && matchesHolder(counterpartyName, holderKeys)) return OWN_TRANSFER_EVIDENCE.NAME;
	}

	return transaction.override === OWN_TRANSFER_OVERRIDES.MARKED ? OWN_TRANSFER_EVIDENCE.MANUAL : null;
}

function getPairEvidence(first: Leg, second: Leg): OwnTransferEvidence {
	if (
		first.ibanTargets.has(second.transaction.bankAccountId) ||
		second.ibanTargets.has(first.transaction.bankAccountId)
	) {
		return OWN_TRANSFER_EVIDENCE.IBAN;
	}
	if (first.evidence === OWN_TRANSFER_EVIDENCE.MANUAL || second.evidence === OWN_TRANSFER_EVIDENCE.MANUAL) {
		return OWN_TRANSFER_EVIDENCE.MANUAL;
	}
	return OWN_TRANSFER_EVIDENCE.NAME;
}

function createHolderKeys(holderNames: (string | null)[]): Set<string> {
	const keys = new Set<string>();
	for (const holderName of holderNames) {
		for (const key of nameKeys(holderName)) keys.add(key);
	}
	return keys;
}

function matchesHolder(name: string, holderKeys: Set<string>): boolean {
	return nameKeys(name).some((key) => holderKeys.has(key));
}

/**
 * The full name, plus first given name and surname when the given name is written out. An initial alone
 * never shortens a name, so "J Example" cannot stand for "J P Example" or the other way round.
 */
function nameKeys(name: string | null): string[] {
	const tokens = tokenizeName(name);
	while (tokens.length > 2 && SALUTATIONS.has(tokens[0])) tokens.shift();
	if (tokens.length < 2) return [];

	const keys = [tokens.join(' ')];
	const givenName = tokens[0].split('-')[0];
	if (givenName.length >= 2) keys.push(`${givenName} ${tokens[tokens.length - 1]}`);
	return keys;
}

function tokenizeName(name: string | null): string[] {
	return (name ?? '')
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.toUpperCase()
		.replace(/[^\p{L}\- ]/gu, ' ')
		.split(' ')
		.filter(Boolean);
}

function ibanKey(iban: string, currency: string): string {
	return `${iban.toUpperCase()}:${currency.toUpperCase()}`;
}

/** Exact decimal comparison without floating point: returns the sign and a canonical magnitude string. */
function parseAmount(value: string): {sign: -1 | 1; magnitude: string} | null {
	const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(value.trim());
	if (!match) return null;

	const integer = match[2].replace(/^0+/, '');
	const fraction = (match[3] ?? '').replace(/0+$/, '');
	if (!integer && !fraction) return null;

	return {sign: match[1] === '-' ? -1 : 1, magnitude: `${integer || '0'}${fraction ? `.${fraction}` : ''}`};
}

function parseDay(value: string | null): number | null {
	if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
	const time = Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
	return Number.isNaN(time) ? null : Math.round(time / DAY_MS);
}

export function compareIds(first: string, second: string): number {
	return first < second ? -1 : first > second ? 1 : 0;
}
