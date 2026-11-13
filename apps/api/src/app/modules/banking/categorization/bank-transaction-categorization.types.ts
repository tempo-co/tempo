import type {BankTransactionCategory} from '@tempo/contracts';

import type {BankTransactionDirection} from '../bank-transaction-direction';

export type {
	BankTransactionCategorizationInput,
	BankTransactionCategorizationWebSearchInput,
	PreviousManualCategory,
	SameAmountPayment,
} from './bank-transaction-categorization-input.schema';

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
	/** The route that answered. */
	provider: string;
	model: string;
	searchTrace?: BankTransactionCategorizationSearchTrace;
};

/**
 * One row's web search. `result` is null when the search failed: it may have run, or it was refused in a way a retry
 * would not change. A search that could run on neither route but may succeed later is thrown as the unavailable
 * error instead.
 */
export type BankTransactionCategorizationWebSearchOutcome = {
	correlationId: string;
	/** The route that ran, or last refused, the search. */
	provider: string;
	result: BankTransactionCategorizationResult | null;
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
