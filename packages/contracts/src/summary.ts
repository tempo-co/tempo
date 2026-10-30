import type {CashFlowInterval} from './banking-values.js';
import type {BankTransactionCategoryFilterValue} from './categories.js';

/** `GET /bank-transactions/summary` query. */
export type BankTransactionSummaryQuery = {
	/** `YYYY-MM`. */
	month: string;
	/** The client's local date; the current month is summarized through this day. */
	asOf: string;
};

/** `GET /bank-transactions/cash-flow` and `GET /bank-transactions/balance-trend` query. */
export type BankTransactionCashFlowQuery = {
	interval: CashFlowInterval;
	/** Any day in the first period; the period starts on its Monday, 1st or 1 January. */
	from: string;
	/** The last day to count, on or before `asOf`. */
	to: string;
	/** The client's local date. A period is complete only once it has ended before this day. */
	asOf: string;
};

export type SpendingPaceDay = {day: number; spending: string; cumulative: string};
export type BaselineTotal = {average: string; low: string | null; high: string | null};
export type BaselineDay = {day: number} & BaselineTotal;

export type BankTransactionSummaryCategory = {
	category: BankTransactionCategoryFilterValue;
	spending: string;
	count: number;
	/** Same-day average for the current month; whole-month average for a past month. */
	baselineAverage: string | null;
};

/** `GET /bank-transactions/summary`. Money fields are decimal strings with two places in the owner's base currency. */
export type BankTransactionSummary = {
	month: string;
	through: string;
	daysInMonth: number;
	/** Null until the owner's first conversion run has picked a base currency. */
	baseCurrency: string | null;
	totals: {spending: string; income: string; net: string; ownTransfers: string};
	/** Rows in the period left out of the totals. */
	excluded: {unknownDirection: number; missingBaseAmount: number};
	daily: SpendingPaceDay[];
	baseline: {
		months: string[];
		daily: BaselineDay[];
		/** Same-day average for the current month; whole-month average for a past month. */
		spendingByThrough: string | null;
		/** Same comparison period as spendingByThrough; null with fewer than two baseline months. */
		spendingRangeByThrough: {low: string; high: string} | null;
		/** Same-day average for the current month; whole-month average for a past month. */
		incomeByThrough: string | null;
	};
	categories: BankTransactionSummaryCategory[];
};

export type BankTransactionCashFlowPeriod = {
	/** First day of the period: a Monday, the 1st, or 1 January. */
	start: string;
	/** Last day counted: the period's last day, or `to` when the period is still running. */
	end: string;
	/** False when the period is cut at `to` or starts before the first booked transaction. */
	complete: boolean;
	spending: string;
	income: string;
	net: string;
};

/** `GET /bank-transactions/cash-flow`: totals per week, month or year on the summary's definitions, oldest first. */
export type BankTransactionCashFlow = {
	baseCurrency: string | null;
	interval: CashFlowInterval;
	/** Every period from the first booked transaction (or `from`) through `to`, including empty ones. */
	periods: BankTransactionCashFlowPeriod[];
};

export type BankBalanceTrendPeriod = {
	/** First day of the period: a Monday, the 1st, or 1 January. */
	start: string;
	/** The day the balances are for: the period's last day, or `to` while it is still running. */
	end: string;
	/** False while the period is still running. */
	complete: boolean;
	/** Sum of the account balances; null when an account with history by then has no exchange rate. */
	total: string | null;
	/** Every connected account; `balance` is null before its history starts or without a rate. */
	accounts: Array<{id: string; balance: string | null}>;
};

/** `GET /bank-transactions/balance-trend`: combined balance at the end of each period, oldest first. */
export type BankBalanceTrend = {
	baseCurrency: string | null;
	interval: CashFlowInterval;
	/** Every period from the first one any connected account covers through `to`. */
	periods: BankBalanceTrendPeriod[];
};

/** `GET /bank-transactions/review-counts`. */
export type BankTransactionReviewCounts = {
	needsReview: number;
	categorizationFailed: number;
	categorizing: number;
	unknownDirection: number;
	missingBaseAmount: number;
};

/** `GET /bank-transactions/totals`: totals over all filtered rows, as decimal base-currency strings. */
export type BankTransactionTotals = {
	baseCurrency: string | null;
	spending: string;
	income: string;
	net: string;
	count: number;
	excluded: {unknownDirection: number; missingBaseAmount: number};
};
