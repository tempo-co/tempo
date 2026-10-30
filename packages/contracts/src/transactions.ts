import type {
	BankTransactionBaseAmountFilterValue,
	BankTransactionBaseAmountMethod,
	BankTransactionCashFlowFilterValue,
	BankTransactionCashFlowTreatment,
	BankTransactionCategorizationSource,
	BankTransactionCategorizationStatus,
	BankTransactionCategoryStatusFilterValue,
	BankTransactionDirection,
	BankTransactionFinancialEventFilterValue,
	BankTransactionFinancialEventSource,
	BankTransactionFinancialEventType,
	BankTransactionSortField,
	BankTransactionType,
	OwnTransferEvidence,
	OwnTransferOverride,
	SortOrder,
} from './banking-values.js';
import type {BankTransactionCategory, BankTransactionCategoryFilterValue} from './categories.js';

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
