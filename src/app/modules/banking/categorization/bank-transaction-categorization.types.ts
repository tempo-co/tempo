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

/** `HISTORY` rows reuse the owner's own manual category for the same merchant instead of asking the model. */
export const BANK_TRANSACTION_CATEGORIZATION_SOURCES = ['AI', 'HISTORY', 'MANUAL'] as const;
export type BankTransactionCategorizationSource = (typeof BANK_TRANSACTION_CATEGORIZATION_SOURCES)[number];

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
	/** Categories the user chose manually for the same merchant, most frequent first. Not part of the input hash. */
	previousManualCategories?: readonly {category: BankTransactionCategory; count: number}[];
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
