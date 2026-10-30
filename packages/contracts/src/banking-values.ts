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

export const BANK_CONNECTION_STATUSES = [
	'AUTHORIZED',
	'EXPIRED',
	'RUNNING',
	'PENDING_AUTHORIZATION',
	'CANCELLED',
	'FAILED',
] as const;
export type BankConnectionStatus = (typeof BANK_CONNECTION_STATUSES)[number];

export const BANK_SYNC_STATUSES = [
	'IDLE',
	'QUEUED',
	'RUNNING',
	'SUCCEEDED',
	'PARTIAL',
	'FAILED',
	'RATE_LIMITED',
	'EXPIRED',
] as const;
export type BankSyncStatus = (typeof BANK_SYNC_STATUSES)[number];

export const CASH_FLOW_INTERVALS = ['week', 'month', 'year'] as const;
export type CashFlowInterval = (typeof CASH_FLOW_INTERVALS)[number];
