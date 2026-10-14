import type {BankTransactionCategoryFilterValue} from '../../categorization/bank-transaction-category';
import type {BaselineDay, SpendingPaceDay} from '../../summary/bank-transaction-summary';

/** Money fields are decimal strings with two places in the owner's base currency. */
export class BankTransactionSummaryResponseDto {
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
	categories: BankTransactionSummaryCategoryDto[];
}

export class BankTransactionSummaryCategoryDto {
	category: BankTransactionCategoryFilterValue;
	spending: string;
	count: number;
	/** Same-day average for the current month; whole-month average for a past month. */
	baselineAverage: string | null;
}

/** Totals per week, month or year on the summary's definitions, oldest first. Money as in the summary. */
export class BankTransactionCashFlowResponseDto {
	baseCurrency: string | null;
	interval: 'week' | 'month' | 'year';
	/** Every period from the first booked transaction (or `from`) through `to`, including empty ones. */
	periods: BankTransactionCashFlowPeriodDto[];
}

export class BankTransactionCashFlowPeriodDto {
	/** First day of the period: a Monday, the 1st, or 1 January. */
	start: string;
	/** Last day counted: the period's last day, or `to` when the period is still running. */
	end: string;
	/** False when the period is cut at `to` or starts before the first booked transaction. */
	complete: boolean;
	spending: string;
	income: string;
	net: string;
}

export class BankTransactionReviewCountsResponseDto {
	needsReview: number;
	categorizationFailed: number;
	categorizing: number;
	unknownDirection: number;
	missingBaseAmount: number;
}
