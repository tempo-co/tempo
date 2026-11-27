import type {BankTransactionCategory, BankTransactionCategoryFilterValue} from './categories.js';

export const CASH_FLOW_INTERVALS = ['week', 'month', 'year'] as const;
export type CashFlowInterval = (typeof CASH_FLOW_INTERVALS)[number];
/** The balance trend also reads day ends, over a short range. */
export const BALANCE_TREND_INTERVALS = ['day', ...CASH_FLOW_INTERVALS] as const;
export type BalanceTrendInterval = (typeof BALANCE_TREND_INTERVALS)[number];
/** The most periods one cash-flow, balance-trend, breakdown or merchant-periods request may cover. */
export const MAX_RANGE_PERIODS = {day: 92, week: 104, month: 240, year: 20} as const satisfies Record<
	BalanceTrendInterval,
	number
>;

/** `GET /bank-transactions/summary` query. */
export type BankTransactionSummaryQuery = {
	/** `YYYY-MM`. */
	month: string;
	/** The client's local date; the current month is summarized through this day. */
	asOf: string;
};

/** `GET /bank-transactions/cash-flow` query. */
export type BankTransactionCashFlowQuery = {
	interval: CashFlowInterval;
	/** Any day in the first period; the period starts on its Monday, 1st or 1 January. */
	from: string;
	/** The last day to count, on or before `asOf`. */
	to: string;
	/** The client's local date. A period is complete only once it has ended before this day. */
	asOf: string;
};

/** `GET /bank-transactions/balance-trend` query: the cash-flow query, plus day ends over a short range. */
export type BankBalanceTrendQuery = Omit<BankTransactionCashFlowQuery, 'interval'> & {
	interval: BalanceTrendInterval;
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
	/** The reporting currency; null while there is none or its amounts are being converted (`GET /reporting-currency`). */
	baseCurrency: string | null;
	totals: {spending: string; income: string; net: string; ownTransfers: string};
	/** Rows in the period left out of the totals. */
	excluded: {missingBaseAmount: number};
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
	/** First day of the period: the day itself, a Monday, the 1st, or 1 January. */
	start: string;
	/** The day the balances are for: the period's last day, or `to` while it is still running. */
	end: string;
	/** False while the period is still running. */
	complete: boolean;
	/**
	 * Sum of the shown accounts' balances; null when one with history by then has no exchange rate, or when only hidden
	 * accounts have history by then. Hidden accounts count in no total.
	 */
	total: string | null;
	/** Every connected account, hidden ones too; `balance` is null before its history starts or without a rate. */
	accounts: Array<{id: string; balance: string | null}>;
};

/** `GET /bank-transactions/balance-trend`: combined balance at the end of each period, oldest first. */
export type BankBalanceTrend = {
	baseCurrency: string | null;
	interval: BalanceTrendInterval;
	/** Every period from the first one any connected account covers through `to`. */
	periods: BankBalanceTrendPeriod[];
};

export const BREAKDOWN_INTERVALS = ['month', 'year'] as const;
export type BreakdownInterval = (typeof BREAKDOWN_INTERVALS)[number];
/**
 * `category`: spending (net of refunds) by category; `source`: income by merchant; `allCategories`: every transaction
 * by its category in either direction, as the list's category filter matches them.
 */
export const BREAKDOWN_DIMENSIONS = ['category', 'source', 'allCategories'] as const;
export type BreakdownDimension = (typeof BREAKDOWN_DIMENSIONS)[number];

/** `GET /bank-transactions/breakdown` query. */
export type BankTransactionBreakdownQuery = {
	interval: BreakdownInterval;
	by: BreakdownDimension;
	/** Any day in the first period; the period starts on its 1st or 1 January. */
	from: string;
	/** The last day to count, on or before `asOf`. */
	to: string;
	/** The client's local date. A period is complete only once it has ended before this day. */
	asOf: string;
};

export type BankTransactionBreakdownPart = {
	/** The category (or `UNCATEGORIZED`), or for income the merchant key, falling back to the display name. */
	key: string;
	/** The category again, or the source's most common display name. */
	label: string;
	/**
	 * Spending is positive; a part that only holds refunds is negative. `allCategories` keeps the ledger's sign (money
	 * in positive) and leaves rows without a base-currency amount out of the amount but not the count.
	 */
	amount: string;
	/** The transactions in the part. */
	count: number;
	/** Sources only: the logo of the merchant of the source's latest income, null without a trusted one. */
	merchantLogoUrl?: string | null;
	/** Sources only: the latest income's category, the icon shown without a logo. */
	category?: BankTransactionCategory | null;
};

export type BankTransactionBreakdownPeriod = {
	/** First day of the period: the 1st or 1 January. */
	start: string;
	/** Last day counted: the period's last day, or `to` when the period is still running. */
	end: string;
	/** False when the period is cut at `to` or starts before the first booked transaction. */
	complete: boolean;
	/** The period's spending or income, equal to cash flow's for the same period; under `allCategories`, its parts' net. */
	total: string;
	/** Largest first; parts that net to zero are left out, except under `allCategories`, which keeps every row. */
	parts: BankTransactionBreakdownPart[];
};

/** `GET /bank-transactions/breakdown`: spending by category or income by source per month or year, oldest first. */
export type BankTransactionBreakdown = {
	baseCurrency: string | null;
	interval: BreakdownInterval;
	by: BreakdownDimension;
	/** Every period from the first booked transaction (or `from`) through `to`, including empty ones. */
	periods: BankTransactionBreakdownPeriod[];
};

/** `GET /bank-transactions/review-counts`. */
export type BankTransactionReviewCounts = {
	needsReview: number;
	categorizationFailed: number;
	categorizing: number;
	missingBaseAmount: number;
	/** Rows to review or whose categorization failed, each counted once: the groups above can overlap. */
	needsAttention: number;
};

/** `GET /bank-transactions/totals`: totals over all filtered rows, as decimal base-currency strings. */
export type BankTransactionTotals = {
	baseCurrency: string | null;
	spending: string;
	income: string;
	net: string;
	count: number;
	excluded: {missingBaseAmount: number};
};

/** One day of `GET /bank-transactions/day-totals`, on the totals' definitions. */
export type BankTransactionDayTotal = {
	/** `YYYY-MM-DD`, the day the list dates the rows by. */
	date: string;
	spending: string;
	income: string;
	net: string;
};

/** `GET /bank-transactions/day-totals`: the totals of each day with filtered rows, newest first. */
export type BankTransactionDayTotals = {
	baseCurrency: string | null;
	days: BankTransactionDayTotal[];
};

/** `GET /bank-transactions/spending-pace` and `GET /bank-connections/coverage` query. */
export type HomeReadQuery = {
	/** The client's local date: the month it falls in is this month, and no day after it counts. */
	asOf: string;
};

/** How many complete months before this one the usual pace averages, at most. */
export const USUAL_PACE_MONTHS = 6;
/** The usual pace is left out while fewer complete months than this exist. */
export const MIN_USUAL_PACE_MONTHS = 2;

/**
 * The usual pace: the average of the complete months before this one (the newest `USUAL_PACE_MONTHS` at most), each
 * month's spending added up day by day. A shorter month holds its last day's total to the end of this one.
 */
export type UsualPace = {
	/** `YYYY-MM`, oldest first. */
	months: string[];
	/** Every day of this month; `average` is the usual spending up to and including that day. */
	daily: BaselineDay[];
	/** The usual spending up to the last covered day's day of the month. */
	byLastCoveredDay: string;
	/** The usual spending over a whole month as long as this one. */
	month: string;
};

/**
 * `GET /bank-transactions/spending-pace`: this month's spending, added up day by day through the last covered day,
 * against the usual pace. Money fields are decimal strings with two places in the reporting currency, counted by the
 * same rule as every other total.
 */
export type SpendingPace = {
	/** The reporting currency; null while there is none or its amounts are being converted (`GET /reporting-currency`). */
	baseCurrency: string | null;
	/** `YYYY-MM` of `asOf`. */
	month: string;
	daysInMonth: number;
	/**
	 * The newest day the owner's data covers, never after `asOf`: across their accounts, the day each account's
	 * transactions were last fetched completely and the end date of the newest import not undone. Null without any.
	 */
	lastCoveredDay: string | null;
	/** One entry per day of this month through the last covered day; empty when that day is before this month. */
	daily: SpendingPaceDay[];
	/**
	 * The runs of `daily`'s days no data covers, as days of the month (both included), oldest first: their spending is
	 * unknown, not zero.
	 */
	uncovered: Array<{from: number; to: number}>;
	/** Spending and income this month through the last covered day. */
	spending: string;
	income: string;
	/** Null while fewer than `MIN_USUAL_PACE_MONTHS` complete months exist. */
	usual: UsualPace | null;
};

/** A run of days, both included (`YYYY-MM-DD`). */
export type DateRange = {from: string; to: string};

/** Where an account's data comes from: its bank's sync, or statement files. */
export type DataCoverageSource = 'sync' | 'file';

/** One account's coverage over the window. */
export type DataCoverageAccount = {
	bankAccountId: string;
	source: DataCoverageSource;
	/** The newest day the account's data covers, not after `asOf`; null when nothing covers it yet. */
	coveredThrough: string | null;
	/** The days of the window the account's data covers, oldest first, apart and not touching. */
	ranges: DateRange[];
};

/** The days `GET /bank-connections/coverage` covers: the 30 days ending on `asOf`. */
export const DATA_COVERAGE_DAYS = 30;

/**
 * `GET /bank-connections/coverage`: which of the last `DATA_COVERAGE_DAYS` days each account's data covers: from its
 * first transaction through its last covered day, the newer of its last complete transaction fetch and its newest
 * import not undone, without the gaps something recorded (between imported statements, before a reconnect).
 */
export type DataCoverage = {
	/** The window, both days included. */
	from: string;
	to: string;
	/** As in `SpendingPace`: the newest of the accounts' `coveredThrough`. */
	lastCoveredDay: string | null;
	accounts: DataCoverageAccount[];
};
