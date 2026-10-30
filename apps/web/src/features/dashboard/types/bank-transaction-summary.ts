import type {BankTransactionCategoryFilterValue} from '@tempo/contracts';

/** Money fields are decimal strings with two places in the owner's base currency. */
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
  baseline: {months: string[]};
  categories: BankTransactionSummaryCategory[];
};

export type BankTransactionReviewCounts = {
  needsReview: number;
  categorizationFailed: number;
  categorizing: number;
  unknownDirection: number;
  missingBaseAmount: number;
};
