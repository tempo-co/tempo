import type {BankTransactionCategoryFilterValue} from '@/features/banking/types/bank-transaction';

/** Money fields are decimal strings with two places in the owner's base currency. */
export type SpendingPaceDay = {day: number; spending: string; cumulative: string};

/** Cumulative spending by day across the baseline months; the range needs two months. */
export type BaselineDay = {day: number; average: string; low: string | null; high: string | null};

export type BankTransactionSummaryCategory = {
  category: BankTransactionCategoryFilterValue;
  spending: string;
  count: number;
  baselineAverage: string | null;
};

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
    spendingByThrough: string | null;
    /** Same-day range for the current month; full-month range for completed months. */
    spendingRangeByThrough: {low: string; high: string} | null;
    incomeByThrough: string | null;
  };
  categories: BankTransactionSummaryCategory[];
};

export type BankTransactionReviewCounts = {
  needsReview: number;
  categorizationFailed: number;
  categorizing: number;
  unknownDirection: number;
  missingBaseAmount: number;
};
