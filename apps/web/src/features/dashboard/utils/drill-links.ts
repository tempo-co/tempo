import {parse} from 'date-fns';

import type {
  BankTransactionCategoryFilterValue,
  BankTransactionSearchParams,
} from '@/features/banking/types/bank-transaction';

import type {BankTransactionReviewCounts} from '../types/bank-transaction-summary';

/** Search params for a `/bank-transactions/` link; the list fills in pagination defaults. */
export type BankTransactionDrillSearch = Partial<BankTransactionSearchParams>;

/** A local-midnight date for a `YYYY-MM-DD` string, matching what the date filter produces. */
export function parseCalendarDate(value: string) {
  return parse(value, 'yyyy-MM-dd', new Date());
}

function bookingRange(from: string, to: string) {
  return {from: parseCalendarDate(from), to: parseCalendarDate(to)};
}

/** Every transaction booked between two calendar dates. */
export function periodDrill(from: string, to: string): BankTransactionDrillSearch {
  return {bookingDate: bookingRange(from, to)};
}

/**
 * Exactly the rows behind a spending or income total between two dates: that cash flow, and, when the period
 * has rows still waiting for a base-currency amount, only rows that have one, since totals leave the rest out.
 */
export function flowDrill(
  flow: 'SPENDING' | 'INCOME',
  from: string,
  to: string,
  hasMissingBaseAmounts: boolean,
): BankTransactionDrillSearch {
  return {
    ...periodDrill(from, to),
    cashFlows: [flow],
    ...(hasMissingBaseAmounts ? {baseAmount: 'PRESENT' as const} : {}),
  };
}

/** Exactly the spending rows behind one or more category totals between two dates. */
export function categoryDrill(
  categories: BankTransactionCategoryFilterValue | BankTransactionCategoryFilterValue[],
  from: string,
  to: string,
  hasMissingBaseAmounts: boolean,
): BankTransactionDrillSearch {
  return {
    ...flowDrill('SPENDING', from, to, hasMissingBaseAmounts),
    categories: Array.isArray(categories) ? categories : [categories],
  };
}

/** All-time rows behind each review count. */
export const reviewDrills = {
  needsReview: {categories: ['NEEDS_REVIEW']},
  categorizationFailed: {categoryStatuses: ['FAILED']},
  categorizing: {categoryStatuses: ['CATEGORIZING']},
  unknownDirection: {cashFlows: ['UNKNOWN']},
  // Internal rows are left out of the count, so they are left out of the list too.
  missingBaseAmount: {cashFlows: ['SPENDING', 'INCOME', 'UNKNOWN'], baseAmount: 'MISSING'},
} as const satisfies Record<keyof BankTransactionReviewCounts, BankTransactionDrillSearch>;

/** Rows a period leaves out of its totals, matching the summary's `excluded` counts. */
export function excludedDrill(
  key: 'unknownDirection' | 'missingBaseAmount',
  from: string,
  to: string,
): BankTransactionDrillSearch {
  return {bookingDate: bookingRange(from, to), ...reviewDrills[key]};
}
