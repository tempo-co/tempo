import type {BankTransactionCategory} from './categories.js';

export const RECURRING_CADENCES = ['WEEKLY', 'FOUR_WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'] as const;
export type RecurringCadence = (typeof RECURRING_CADENCES)[number];

export const RECURRING_AMOUNT_KINDS = ['FIXED', 'VARIABLE'] as const;
export type RecurringAmountKind = (typeof RECURRING_AMOUNT_KINDS)[number];

export const RECURRING_SERIES_STATUSES = ['ACTIVE', 'ENDED'] as const;
export type RecurringSeriesStatus = (typeof RECURRING_SERIES_STATUSES)[number];

export const RECURRING_SERIES_FLAGS = ['LATE', 'HIGHER_THAN_USUAL'] as const;
export type RecurringSeriesFlag = (typeof RECURRING_SERIES_FLAGS)[number];

export const RECURRING_SERIES_DIRECTIONS = ['EXPENSE', 'INCOME'] as const;
export type RecurringSeriesDirection = (typeof RECURRING_SERIES_DIRECTIONS)[number];

/** `GET /recurring-series` and `GET /recurring-series/summary` query. */
export type RecurringSeriesQuery = {
	/** The client's local date (`YYYY-MM-DD`); late and ended are judged against it. */
	asOf: string;
};

/** `PATCH /recurring-series/:key/hidden` body. */
export type RecurringSeriesHiddenUpdate = {
	/** `true` marks the series as not recurring; `false` shows it again. */
	hidden: boolean;
};

/** `PATCH /recurring-series/:key/continuation` body. */
export type RecurringContinuationUpdate = {
	/** `false` splits a joined series into its two histories; `true` joins them again. */
	linked: boolean;
};

/** The earlier history a series continues: joined with it, or kept apart because the owner unlinked them. */
export type RecurringContinuation = {
	previousName: string;
	previousFirstDate: string;
	previousLastDate: string;
	/** `false` once unlinked; linking again joins them. */
	linked: boolean;
};

/** A fixed price's recent change. */
export type RecurringPriceChange = {
	/** Signed difference, e.g. "1.50" or "-3.50". */
	amount: string;
	/** Date of the first payment at the new price. */
	since: string;
};

/** A variable amount's lowest and highest recent payment. */
export type RecurringAmountRange = {low: string; high: string};

export type RecurringPayment = {date: string; amount: string};

/**
 * A detected series of payments. Amounts are positive decimal strings with two places; `monthlyEquivalent` is in the
 * owner's base currency.
 */
export type RecurringSeries = {
	key: string;
	name: string;
	direction: RecurringSeriesDirection;
	cadence: RecurringCadence;
	amountKind: RecurringAmountKind;
	currency: string;
	/** A fixed price, or the median of a variable amount's recent payments. */
	typicalAmount: string;
	latestAmount: string;
	/**
	 * This month's cost: the usual amount per month, or what a variable monthly bill was paid in the month of its latest
	 * payment. Null until every payment in the series has a base-currency amount.
	 */
	monthlyEquivalent: string | null;
	/** Set for a variable amount. */
	amountRange: RecurringAmountRange | null;
	/** A variable amount's recent payments, oldest first; empty for a fixed price. */
	recentPayments: RecurringPayment[];
	transactionCount: number;
	firstDate: string;
	lastDate: string;
	nextExpectedDate: string;
	status: RecurringSeriesStatus;
	flags: RecurringSeriesFlag[];
	/** Set until the new price has been paid three times. */
	priceChange: RecurringPriceChange | null;
	/** The owner marked it as not recurring; it is left out of totals. */
	hidden: boolean;
	/** Set while the series continues an earlier history, linked or unlinked. */
	continuation: RecurringContinuation | null;
	/** The latest payment's category. */
	category: BankTransactionCategory | null;
	/** Path of the latest payment's merchant logo on the API; null when no trusted logo exists. */
	merchantLogoUrl: string | null;
};

/**
 * One direction's calendar month in the base currency: what its counted series paid so far, and their usual amount
 * for each payment still expected before the month ends, late ones included.
 */
export type RecurringThisMonth = {
	/** `YYYY-MM` of `asOf`. */
	month: string;
	paid: string;
	remaining: string;
};

/** One direction's series and total. */
export type RecurringSeriesList = {
	/** Shown before hidden; active before ended; larger monthly cost first. */
	series: RecurringSeries[];
	/** Monthly cost of shown active series that have a base amount. */
	monthlyTotal: string;
	/** Shown active series left out of the total because a payment is not converted yet. */
	unconvertedCount: number;
	thisMonth: RecurringThisMonth;
	baseCurrency: string | null;
};

/** `GET /recurring-series`: bills and income, from one read. */
export type RecurringSeriesLists = {
	expenses: RecurringSeriesList;
	income: RecurringSeriesList;
};

/** A counted series' next payment. */
export type RecurringUpcomingPayment = Pick<
	RecurringSeries,
	| 'key'
	| 'name'
	| 'direction'
	| 'nextExpectedDate'
	| 'typicalAmount'
	| 'amountKind'
	| 'currency'
	| 'category'
	| 'merchantLogoUrl'
	| 'flags'
>;

/** `GET /recurring-series/summary`. */
export type RecurringSummary = {
	/** The bills and income lists' monthly totals. */
	expenseMonthlyTotal: string;
	incomeMonthlyTotal: string;
	/** The bills and income lists' `thisMonth`. */
	expenseThisMonth: RecurringThisMonth;
	incomeThisMonth: RecurringThisMonth;
	/** The three soonest next payments of shown active series, bills and income together. */
	upcoming: RecurringUpcomingPayment[];
	/** Each list's shown active series left out of its total because a payment is not converted yet. */
	expenseUnconvertedCount: number;
	incomeUnconvertedCount: number;
	baseCurrency: string | null;
};
