import type {BankTransactionCategory, BankTransactionCategoryFilterValue} from './categories.js';
import type {RecurringCadence, RecurringSeriesStatus} from './recurring.js';

/** `GET /bank-transactions/:id/recurring`; null when the payment has no visible detected series. */
export type BankTransactionRecurring = {
	key: string;
	cadence: RecurringCadence;
	status: RecurringSeriesStatus;
	nextExpectedDate: string;
	/** The newest three series payments in ledger order, with their original signed amounts. */
	payments: Array<Pick<BankTransaction, 'id' | 'transactionDate' | 'bookingDate' | 'amount' | 'currency'>>;
};

export const BANK_TRANSACTION_DIRECTIONS = ['INCOME', 'EXPENSE'] as const;
export type BankTransactionDirection = (typeof BANK_TRANSACTION_DIRECTIONS)[number];

/** The stored direction code: every row is a credit or a debit (ISO 20022 `CdtDbtInd`). */
export const CREDIT_DEBIT_INDICATORS = ['CRDT', 'DBIT'] as const;
export type CreditDebitIndicator = (typeof CREDIT_DEBIT_INDICATORS)[number];

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
export const BANK_TRANSACTION_CASH_FLOW_TREATMENTS = ['INCOME', 'EXPENSE', 'INTERNAL'] as const;
export type BankTransactionCashFlowTreatment = (typeof BANK_TRANSACTION_CASH_FLOW_TREATMENTS)[number];

export const OWN_TRANSFER_EVIDENCE = ['IBAN', 'NAME', 'DESCRIPTION', 'MANUAL'] as const;
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
	// Rows the owner left out of totals: listed, counted in none.
	'LEFT_OUT',
] as const;
export type BankTransactionCashFlowFilterValue = (typeof BANK_TRANSACTION_CASH_FLOW_FILTER_VALUES)[number];

export const BANK_TRANSACTION_BASE_AMOUNT_FILTER_VALUES = ['PRESENT', 'MISSING'] as const;
export type BankTransactionBaseAmountFilterValue = (typeof BANK_TRANSACTION_BASE_AMOUNT_FILTER_VALUES)[number];

/** Categorization states a list can be filtered by: failed, or still waiting to be categorized. */
export const BANK_TRANSACTION_CATEGORY_STATUS_FILTER_VALUES = ['FAILED', 'CATEGORIZING'] as const;
export type BankTransactionCategoryStatusFilterValue = (typeof BANK_TRANSACTION_CATEGORY_STATUS_FILTER_VALUES)[number];

export const BANK_TRANSACTION_SORT_FIELDS = ['date', 'amount', 'category', 'source'] as const;
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
	/** The day the payment happened, which the list, its filter and every total date it by: the transaction date, else the booking date, else the value date. */
	date: string | null;
	transactionDate: string | null;
	bookingDate: string | null;
	valueDate: string | null;
	description: string | null;
	displayDescription: string;
	/** Path of the merchant's logo image, null when no confirmed logo exists. */
	merchantLogoUrl: string | null;
	/** The merchant group the row counts toward; null for own transfers, currency exchanges and rows without a merchant. */
	merchantGroupId: string | null;
	counterpartyName: string | null;
	amount: string;
	currency: string;
	creditDebitIndicator: CreditDebitIndicator;
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
	/** The owner left the row out of totals: it stays in the list and in balances, and counts in no total. */
	leftOutOfTotals: boolean;
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
	/** The ECB reference rate date used when `baseAmountMethod` is `ECB`; the older one when two rates were combined. */
	baseAmountRateDate: string | null;
	referenceNumber: string | null;
	referenceNumberScheme: string | null;
	/** The owner's bank account the row was booked on, as `GET /bank-connections` lists it. */
	bankAccountId: string;
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
	/** By `date`, both ends included. */
	date?: {from?: string; to?: string};
	/** Older clients' name for `date`. */
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
	/** Only the rows of one merchant group (see `MERCHANT_GROUP_ID_PATTERN`). */
	merchantGroup?: string;
	/** Only the rows of one income source, by its breakdown part's `key`. */
	incomeSource?: string;
	/** Only the rows review counts count as `needsAttention`: to review or failed to categorize. */
	needsAttention?: true;
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

/** Most picked rows one bulk action takes; a selection by the list's filter has no limit. */
export const BANK_TRANSACTION_BULK_MAX_IDS = 500;

/**
 * The rows a bulk action is for: the owner's picked `transactionIds` (at most `BANK_TRANSACTION_BULK_MAX_IDS`), or
 * every row the Transactions list's `filter` matches. A request sends exactly one; the API refuses both or neither (400).
 */
export type BankTransactionBulkSelection = {transactionIds?: string[]; filter?: BankTransactionFilter};

/** `POST /bank-transactions/bulk-category/preview` body: the owner's selected rows and the category picked for them. */
export type BankTransactionBulkCategoryPreviewRequest = BankTransactionBulkSelection & {
	category: BankTransactionCategory;
};

/** One of the owner's other rows from the selected rows' payees that changing all of them would change. */
export type BankTransactionBulkCategoryPreviewTransaction = BankTransactionCategoryImpactTransaction & {
	/** `APPLY` sets `appliedCategory`; `RECHECK` sends the row back to AI categorization (its payee's choices disagree). */
	action: ManualCategoryFollowUpAction;
	/** The category `APPLY` sets; `null` for `RECHECK`. */
	appliedCategory: BankTransactionCategory | null;
};

/** `POST /bank-transactions/bulk-category/preview`. */
export type BankTransactionBulkCategoryPreview = {
	/** The rows past the selection that `ALL` changes, newest first by transaction date (then booking date), capped at 500. */
	transactions: BankTransactionBulkCategoryPreviewTransaction[];
	/** Every such row, including any past the cap; `ALL` changes only the listed ones. */
	total: number;
	/** How many rows the selection holds: the ids sent, or the rows the filter matches now. */
	selected: number;
};

/** `SELECTED` changes only the selected rows; `ALL` also changes the rows the preview lists. */
export const BANK_TRANSACTION_BULK_CATEGORY_SCOPES = ['SELECTED', 'ALL'] as const;
export type BankTransactionBulkCategoryScope = (typeof BANK_TRANSACTION_BULK_CATEGORY_SCOPES)[number];

/** `PATCH /bank-transactions/bulk-category` body. */
export type BankTransactionBulkCategoryUpdate = BankTransactionBulkCategoryPreviewRequest & {
	scope: BankTransactionBulkCategoryScope;
};

/** `PATCH /bank-transactions/bulk-category`: how many rows the write changed, the selection included. */
export type BankTransactionBulkCategoryResult = {updated: number};

/** `PATCH /bank-transactions/:id/own-transfer` body; `null` clears the owner's override. */
export type BankTransactionOwnTransferUpdate = {override: OwnTransferOverride | null};

/** `PATCH /bank-transactions/:id/left-out-of-totals` body; the response is the updated {@link BankTransaction}. */
export type BankTransactionLeftOutOfTotalsUpdate = {leftOutOfTotals: boolean};

/** `PATCH /bank-transactions/bulk-left-out-of-totals` body: leaves the selected rows out of totals, or counts them again. */
export type BankTransactionBulkLeftOutOfTotalsUpdate = BankTransactionBulkSelection &
	BankTransactionLeftOutOfTotalsUpdate;

/** `PATCH /bank-transactions/bulk-left-out-of-totals`: how many selected rows the write changed; rows already so are not. */
export type BankTransactionBulkLeftOutOfTotalsResult = {updated: number};
