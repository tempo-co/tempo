import {
  BANK_TRANSACTION_CATEGORY_FILTER_VALUES,
  BANK_TRANSACTION_UNCATEGORIZED,
  type BankTransactionCategoryFilterValue,
} from '@tempo/contracts';
import {parse} from 'date-fns';

import type {BankTransactionSearchParams} from '@/features/banking/types/bank-transaction';

/** Search params for a `/bank-transactions/` link; the list fills in pagination defaults. */
export type BankTransactionDrillSearch = Partial<BankTransactionSearchParams>;

/** A local-midnight date for a `YYYY-MM-DD` string, matching what the date filter produces. */
export function parseCalendarDate(value: string) {
  return parse(value, 'yyyy-MM-dd', new Date());
}

function dateRange(from: string, to: string) {
  return {from: parseCalendarDate(from), to: parseCalendarDate(to)};
}

/** Every transaction made between two calendar dates. */
export function periodDrill(from: string, to: string): BankTransactionDrillSearch {
  return {date: dateRange(from, to)};
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

/** Exactly the rows behind one income source's total between two dates, by the key the breakdown gives it. */
export function sourceDrill(
  source: string,
  from: string,
  to: string,
  hasMissingBaseAmounts: boolean,
): BankTransactionDrillSearch {
  return {...flowDrill('INCOME', from, to, hasMissingBaseAmounts), incomeSource: source};
}

function toCategoryFilterValue(key: string): BankTransactionCategoryFilterValue {
  return (BANK_TRANSACTION_CATEGORY_FILTER_VALUES as readonly string[]).includes(key)
    ? (key as BankTransactionCategoryFilterValue)
    : BANK_TRANSACTION_UNCATEGORIZED;
}

/**
 * The spending rows behind one or more breakdown keys between two dates. A stored category the list no longer has
 * opens the uncategorized rows, as its label reads Not categorized.
 */
export function categoryDrill(
  keys: string | string[],
  from: string,
  to: string,
  hasMissingBaseAmounts: boolean,
): BankTransactionDrillSearch {
  return {
    ...flowDrill('SPENDING', from, to, hasMissingBaseAmounts),
    categories: [...new Set((Array.isArray(keys) ? keys : [keys]).map(toCategoryFilterValue))],
  };
}
