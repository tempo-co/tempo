import type {BankTransactionCategory} from '@tempo/contracts';

import type {BankTransactionDirection} from '../bank-transaction-direction';
import type {BankTransactionLocation} from '../bank-transaction-location';

/** Statuses a categorization worker may claim a row from. */
export const CLAIMABLE_CATEGORIZATION_STATUSES = ['PENDING', 'FAILED'] as const;

/** Manual categories belong to the owner: nothing automatic may overwrite them. */
export function isManualCategorySource(source: string | null | undefined): boolean {
	return source === 'MANUAL';
}

/** SQL condition for rows whose category automation may still change; `column` is the quoted categorySource. */
export function notManualCategorySourceSql(column = '"categorySource"'): string {
	return `${column} IS DISTINCT FROM 'MANUAL'`;
}

export type BankTransactionCategorizationInput = {
	correlationId: string;
	transactionDate: string | null;
	bookingDate: string | null;
	valueDate: string | null;
	amount: string;
	currency: string;
	creditDebitIndicator: string | null;
	direction: BankTransactionDirection;
	transactionType: string;
	bankTransactionCode: string | null;
	bankTransactionSubCode: string | null;
	description: string | null;
	counterpartyName: string | null;
	merchantLocation?: BankTransactionLocation | null;
	bankTransactionDescription: string | null;
	merchantCategoryCode: string | null;
	remittanceInformation: string | null;
	/**
	 * Categories the user chose manually for the same merchant, most frequent first, with the amounts, currencies and
	 * dates of their most recent choices. Only a hint for the model; never applied without it. Not part of the input
	 * hash.
	 */
	previousManualCategories?: readonly PreviousManualCategory[];
	/**
	 * Earlier completed payments to the same payee with exactly this amount and currency, sent only when there are at
	 * least two: the owner's picks newest first, then the two oldest AI rows per category. Lets the model reuse a
	 * consistent payment's category, such as monthly rent to a person. Only a hint; not part of the input hash.
	 */
	sameAmountPayments?: readonly SameAmountPayment[];
};

export type SameAmountPayment = {
	date: string | null;
	category: BankTransactionCategory;
	source: 'MANUAL' | 'AI';
	text: string | null;
};

export type PreviousManualCategory = {
	category: BankTransactionCategory;
	count: number;
	recentExamples: readonly {amount: string; currency: string; date: string | null}[];
};

export type BankTransactionCategorizationWebSearchInput = Pick<
	BankTransactionCategorizationInput,
	'correlationId' | 'amount' | 'currency' | 'direction' | 'transactionType' | 'merchantCategoryCode'
> & {
	merchantName: string;
	merchantLocation: string | null;
	approximateLocation?: BankTransactionLocation;
	searchQuery: string;
};

export const BANK_TRANSACTION_CATEGORIZATION_SEARCH_EVIDENCE_TYPES = [
	'PURCHASE_CONTEXT',
	'MERCHANT_IDENTITY_ONLY',
	'MCC',
	'INSUFFICIENT',
	'CONFLICTING',
] as const;
export type BankTransactionCategorizationSearchEvidenceType =
	(typeof BANK_TRANSACTION_CATEGORIZATION_SEARCH_EVIDENCE_TYPES)[number];

export type BankTransactionCategorizationSearchTrace = {
	queries: string[];
	sourceDomains: string[];
	evidenceType: BankTransactionCategorizationSearchEvidenceType;
};

export type BankTransactionCategorizationResult = {
	correlationId: string;
	category: BankTransactionCategory;
	confidence: number;
	provider?: string;
	model?: string;
	searchTrace?: BankTransactionCategorizationSearchTrace;
};

export const MERCHANT_KINDS = ['BUSINESS', 'PERSON', 'PAYMENT_SERVICE', 'UNCLEAR'] as const;
export type MerchantKind = (typeof MERCHANT_KINDS)[number];

/** One merchant to identify: the statement name without card or reference details, never amounts or dates. */
export type MerchantIdentificationInput = {
	correlationId: string;
	name: string;
	location: string | null;
	transactionType: string;
	direction: BankTransactionDirection;
	/** Hostnames an earlier categorization web search returned for this merchant. */
	searchSourceDomains: readonly string[];
};

export type MerchantIdentification = {
	correlationId: string;
	kind: MerchantKind;
	/** Set for a business or a payment service. */
	brand: string | null;
	/** A well-formed lowercase hostname without `www.`, set with a brand; not yet confirmed by its site. */
	domain: string | null;
	/** Whether the model was sure the domain is the brand's own site rather than its best guess. */
	domainConfident: boolean;
};
