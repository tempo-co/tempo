import type {BankTransactionCategory, BankTransactionCategoryFilterValue} from './categories.js';

export const BANK_TRANSACTION_DIRECTIONS = ['INCOME', 'EXPENSE', 'UNKNOWN'] as const;
export type BankTransactionDirection = (typeof BANK_TRANSACTION_DIRECTIONS)[number];

export const BANK_TRANSACTION_TYPES = [
	'CARD_PAYMENT',
	'TRANSFER',
	'DIRECT_DEBIT',
	'CASH_WITHDRAWAL',
	'FEE',
	'INTEREST',
	'SALARY',
	'REFUND',
	'OTHER',
] as const;
export type BankTransactionType = (typeof BANK_TRANSACTION_TYPES)[number];

export const BANK_TRANSACTION_CATEGORIZATION_STATUSES = [
	'PENDING',
	'PROCESSING',
	'COMPLETED',
	'FAILED',
	'NOT_APPLICABLE',
] as const;
export type BankTransactionCategorizationStatus = (typeof BANK_TRANSACTION_CATEGORIZATION_STATUSES)[number];

/**
 * `HISTORY` rows took the owner's manual category for the same merchant because the owner selected them in a correction
 * preview. Manual choices are otherwise only a hint for the model and never applied on their own.
 */
export const BANK_TRANSACTION_CATEGORIZATION_SOURCES = ['AI', 'HISTORY', 'MANUAL'] as const;
export type BankTransactionCategorizationSource = (typeof BANK_TRANSACTION_CATEGORIZATION_SOURCES)[number];

export const BANK_TRANSACTION_FINANCIAL_EVENT_TYPES = ['CURRENCY_EXCHANGE'] as const;
export type BankTransactionFinancialEventType = (typeof BANK_TRANSACTION_FINANCIAL_EVENT_TYPES)[number];

export const BANK_TRANSACTION_FINANCIAL_EVENT_SOURCES = ['RULE'] as const;
export type BankTransactionFinancialEventSource = (typeof BANK_TRANSACTION_FINANCIAL_EVENT_SOURCES)[number];

/** How a row counts in cash flow. */
export const BANK_TRANSACTION_CASH_FLOW_TREATMENTS = ['INCOME', 'EXPENSE', 'INTERNAL', 'UNKNOWN'] as const;
export type BankTransactionCashFlowTreatment = (typeof BANK_TRANSACTION_CASH_FLOW_TREATMENTS)[number];

export const OWN_TRANSFER_EVIDENCE = ['IBAN', 'NAME', 'MANUAL'] as const;
export type OwnTransferEvidence = (typeof OWN_TRANSFER_EVIDENCE)[number];

export const OWN_TRANSFER_OVERRIDES = ['MARKED', 'UNMARKED'] as const;
export type OwnTransferOverride = (typeof OWN_TRANSFER_OVERRIDES)[number];

export const BANK_TRANSACTION_BASE_AMOUNT_METHODS = ['SAME', 'INSTRUCTED', 'ECB'] as const;
export type BankTransactionBaseAmountMethod = (typeof BANK_TRANSACTION_BASE_AMOUNT_METHODS)[number];

/** Filter-only value: transactions recognized as transfers between the owner's own accounts. */
export const BANK_TRANSACTION_OWN_TRANSFER_FILTER = 'OWN_TRANSFER' as const;

export const BANK_TRANSACTION_FINANCIAL_EVENT_FILTER_VALUES = [
	...BANK_TRANSACTION_FINANCIAL_EVENT_TYPES,
	BANK_TRANSACTION_OWN_TRANSFER_FILTER,
] as const;
export type BankTransactionFinancialEventFilterValue = (typeof BANK_TRANSACTION_FINANCIAL_EVENT_FILTER_VALUES)[number];

/**
 * List and summary cash flows. Unlike the per-row treatment, refunds count as (negative) spending and payments to
 * other people count as spending, so totals reconcile with the Home dashboard.
 */
export const BANK_TRANSACTION_CASH_FLOW_FILTER_VALUES = [
	'SPENDING',
	'INCOME',
	'INTERNAL',
	// The two kinds of internal movement, for narrowing `INTERNAL`.
	'CURRENCY_EXCHANGE',
	BANK_TRANSACTION_OWN_TRANSFER_FILTER,
	'UNKNOWN',
] as const;
export type BankTransactionCashFlowFilterValue = (typeof BANK_TRANSACTION_CASH_FLOW_FILTER_VALUES)[number];

export const BANK_TRANSACTION_BASE_AMOUNT_FILTER_VALUES = ['PRESENT', 'MISSING'] as const;
export type BankTransactionBaseAmountFilterValue = (typeof BANK_TRANSACTION_BASE_AMOUNT_FILTER_VALUES)[number];

/** Categorization states a list can be filtered by: failed, or still waiting to be categorized. */
export const BANK_TRANSACTION_CATEGORY_STATUS_FILTER_VALUES = ['FAILED', 'CATEGORIZING'] as const;
export type BankTransactionCategoryStatusFilterValue = (typeof BANK_TRANSACTION_CATEGORY_STATUS_FILTER_VALUES)[number];

export const BANK_TRANSACTION_SORT_FIELDS = ['bookingDate', 'amount', 'category', 'source'] as const;
export type BankTransactionSortField = (typeof BANK_TRANSACTION_SORT_FIELDS)[number];

export const SORT_ORDERS = ['ASC', 'DESC'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

/** Page sizes the transaction list accepts; 5 is the Home dashboard's recent list. */
export const BANK_TRANSACTION_PAGE_SIZE_OPTIONS = [5, 10, 20, 30, 40, 50, 100] as const;
export const BANK_TRANSACTION_SEARCH_MAX_LENGTH = 1000;

/** The other leg of an own transfer or currency exchange. */
export type BankTransactionCounterpart = {
	id: string;
	bankName: string;
	bankAccountName: string | null;
	bankAccountAlias: string | null;
	amount: string;
	currency: string;
	bookingDate: string | null;
};

export type BankTransactionOwnTransfer = {
	evidence: OwnTransferEvidence;
	/** The other leg, or null when no matching transaction is in the connected accounts. */
	counterpart: BankTransactionCounterpart | null;
};

/** `GET /bank-transactions/:id`, and each row of the list. */
export type BankTransaction = {
	id: string;
	transactionDate: string | null;
	bookingDate: string | null;
	valueDate: string | null;
	description: string | null;
	displayDescription: string;
	/** Path of the merchant's logo image, null when no confirmed logo exists. */
	merchantLogoUrl: string | null;
	counterpartyName: string | null;
	amount: string;
	currency: string;
	creditDebitIndicator: string | null;
	direction: BankTransactionDirection;
	transactionType: BankTransactionType;
	transactionStatus: string | null;
	category: BankTransactionCategory | null;
	categoryStatus: BankTransactionCategorizationStatus;
	categorySource: BankTransactionCategorizationSource | null;
	financialEventType: BankTransactionFinancialEventType | null;
	financialEventSource: BankTransactionFinancialEventSource | null;
	financialEventRuleVersion: string | null;
	cashFlowTreatment: BankTransactionCashFlowTreatment;
	ownTransfer: BankTransactionOwnTransfer | null;
	ownTransferOverride: OwnTransferOverride | null;
	/** The other leg of a currency exchange, or null when it is not one or the legs could not be matched. */
	currencyExchangeCounterpart: BankTransactionCounterpart | null;
	categoryConfidence: string | null;
	providerTransactionDescription: string | null;
	merchantCategoryCode: string | null;
	remittanceInformation: string | null;
	balanceAfterAmount: string | null;
	balanceAfterCurrency: string | null;
	instructedAmount: string | null;
	instructedCurrency: string | null;
	exchangeRate: string | null;
	exchangeRateUnitCurrency: string | null;
	exchangeRateType: string | null;
	/** The amount in the owner's base currency, to the cent; null while unconverted. */
	amountInBaseCurrency: string | null;
	/** How the base-currency amount was derived; null while unconverted. */
	baseAmountMethod: BankTransactionBaseAmountMethod | null;
	/** The ECB reference rate date used when `baseAmountMethod` is `ECB`. */
	baseAmountRateDate: string | null;
	referenceNumber: string | null;
	referenceNumberScheme: string | null;
	bankName: string;
	bankCountry: string;
	bankAccountName: string | null;
	bankAccountAlias: string | null;
};

/** `GET /bank-transactions`. */
export type BankTransactionsResponse = {
	transactions: BankTransaction[];
	total: number;
};

/** The list's filters, sent as `filter[...]` query parameters. */
export type BankTransactionFilter = {
	bookingDate?: {from?: string; to?: string};
	bankAccountIds?: string[];
	search?: string;
	categories?: BankTransactionCategoryFilterValue[];
	categorySources?: BankTransactionCategorizationSource[];
	/** Older links' name for the activity part of `cashFlows`. */
	financialEventTypes?: BankTransactionFinancialEventFilterValue[];
	cashFlows?: BankTransactionCashFlowFilterValue[];
	baseAmount?: BankTransactionBaseAmountFilterValue;
	categoryStatuses?: BankTransactionCategoryStatusFilterValue[];
	/** Only the payments of one detected recurring series. */
	recurringSeriesKey?: string;
};

/** `GET /bank-transactions/totals` query: the list's filters without sort or pagination. */
export type BankTransactionTotalsQuery = {filter?: BankTransactionFilter};

/** `GET /bank-transactions` query, sent as bracketed parameters (`pagination[pageIndex]`, `sort[by]`, ...). */
export type BankTransactionsQuery = BankTransactionTotalsQuery & {
	pagination?: {pageIndex?: number; pageSize?: number};
	sort?: {by: BankTransactionSortField; order: SortOrder};
};

/** `GET /bank-transactions/:id/category-impact` query. */
export type BankTransactionCategoryImpactQuery = {category: BankTransactionCategory};

/** One of the owner's other rows that a category correction would change. */
export type BankTransactionCategoryImpactTransaction = Pick<
	BankTransaction,
	| 'id'
	| 'transactionDate'
	| 'bookingDate'
	| 'displayDescription'
	| 'amount'
	| 'currency'
	| 'category'
	| 'categoryStatus'
	| 'categorySource'
>;

export const MANUAL_CATEGORY_FOLLOW_UP_ACTIONS = ['APPLY', 'RECHECK'] as const;
export type ManualCategoryFollowUpAction = (typeof MANUAL_CATEGORY_FOLLOW_UP_ACTIONS)[number];

/** `GET /bank-transactions/:id/category-impact`. */
export type BankTransactionCategoryImpact = {
	/**
	 * `APPLY` sets `category` on every listed row; `RECHECK` sends them back to AI categorization because the owner's
	 * choices for this merchant disagree or none is left. `null` when the correction changes no other row.
	 */
	action: ManualCategoryFollowUpAction | null;
	/** The category `APPLY` sets; `null` for `RECHECK`. */
	category: BankTransactionCategory | null;
	/** The affected rows, newest first by transaction date (then booking date), capped at 500. */
	transactions: BankTransactionCategoryImpactTransaction[];
	/** Every affected row, including any past the cap. */
	total: number;
};

/** `PATCH /bank-transactions/:id/category` body; the response is the updated {@link BankTransaction}. */
export type BankTransactionCategoryUpdate = {
	category: BankTransactionCategory;
	/** The category-impact rows the owner confirmed should follow the correction. */
	applyToTransactionIds?: string[];
};

/** `PATCH /bank-transactions/:id/own-transfer` body; `null` clears the owner's override. */
export type BankTransactionOwnTransferUpdate = {override: OwnTransferOverride | null};
