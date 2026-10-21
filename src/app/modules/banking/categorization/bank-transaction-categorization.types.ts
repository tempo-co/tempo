import type {BankTransactionDirection} from '../bank-transaction-direction';
import type {BankTransactionLocation} from '../bank-transaction-location';
import type {BankTransactionCategory} from './bank-transaction-category';

export const BANK_TRANSACTION_CATEGORIZATION_STATUSES = [
	'PENDING',
	'PROCESSING',
	'COMPLETED',
	'FAILED',
	'NOT_APPLICABLE',
] as const;
export type BankTransactionCategorizationStatus = (typeof BANK_TRANSACTION_CATEGORIZATION_STATUSES)[number];
/** Statuses a categorization worker may claim a row from. */
export const CLAIMABLE_CATEGORIZATION_STATUSES = ['PENDING', 'FAILED'] as const;

/**
 * `HISTORY` rows took the owner's manual category for the same merchant because the owner selected them in a correction
 * preview. Manual choices are otherwise only a hint for the model and never applied on their own.
 */
export const BANK_TRANSACTION_CATEGORIZATION_SOURCES = ['AI', 'HISTORY', 'MANUAL'] as const;
export type BankTransactionCategorizationSource = (typeof BANK_TRANSACTION_CATEGORIZATION_SOURCES)[number];

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
	 * Categories the user chose manually for the same merchant, most frequent first, with the amounts, currencies and dates of their
	 * most recent choices. Only a hint for the model; never applied without it. Not part of the input hash.
	 */
	previousManualCategories?: readonly PreviousManualCategory[];
	/**
	 * Earlier completed payments to the same payee with exactly this amount and currency, most recent first, sent only
	 * when there are at least two. Lets the model reuse a consistent payment's category, such as monthly rent to a
	 * person. Only a hint; not part of the input hash.
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

export type BankTransactionCategoryDefinition = {
	value: BankTransactionCategory;
	label: string;
	description: string;
};

/** Categorization states a list can be filtered by: failed, or still waiting to be categorized. */
export const BANK_TRANSACTION_CATEGORY_STATUS_FILTER_VALUES = ['FAILED', 'CATEGORIZING'] as const;
export type BankTransactionCategoryStatusFilterValue = (typeof BANK_TRANSACTION_CATEGORY_STATUS_FILTER_VALUES)[number];
