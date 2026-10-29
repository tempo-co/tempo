import {
  BANK_TRANSACTION_FILTER_KEYS,
  type BankTransactionCashFlowFilterValue,
  type BankTransactionCategoryStatusFilterValue,
  type BankTransactionFilterParams,
} from '../types/bank-transaction';

/** Labels shared by the Transactions filters and Home's attention rows. */
export const CASH_FLOW_LABELS: Record<BankTransactionCashFlowFilterValue, string> = {
  SPENDING: 'Spending',
  INCOME: 'Income',
  INTERNAL: 'Internal movements',
  CURRENCY_EXCHANGE: 'Currency exchange',
  OWN_TRANSFER: 'Own transfer',
  UNKNOWN: 'Unknown direction',
};

export const CATEGORY_STATUS_LABELS: Record<BankTransactionCategoryStatusFilterValue, string> = {
  FAILED: 'Not categorized',
  CATEGORIZING: 'Categorizing',
};

const isFilterSet = (value: unknown) => (Array.isArray(value) ? value.length > 0 : Boolean(value));

/** How many filters other than the free-text search are set. */
export function countActiveFilters(filters: BankTransactionFilterParams) {
  return BANK_TRANSACTION_FILTER_KEYS.filter((key) => key !== 'search' && isFilterSet(filters[key]))
    .length;
}
