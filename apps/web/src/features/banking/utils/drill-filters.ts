import type {
  BankTransactionBaseAmountFilterValue,
  BankTransactionCashFlowFilterValue,
  BankTransactionCategoryStatusFilterValue,
  BankTransactionFilterParams,
} from '../types/bank-transaction';

/** Chip labels for the filters Home links apply; Home's Attention rows reuse them. */
export const CASH_FLOW_LABELS: Record<BankTransactionCashFlowFilterValue, string> = {
  SPENDING: 'Spending',
  INCOME: 'Income',
  INTERNAL: 'Internal',
  UNKNOWN: 'Unknown direction',
};

export const BASE_AMOUNT_LABELS: Record<BankTransactionBaseAmountFilterValue, string> = {
  PRESENT: 'Converted amount',
  MISSING: 'No converted amount yet',
};

export const CATEGORY_STATUS_LABELS: Record<BankTransactionCategoryStatusFilterValue, string> = {
  FAILED: 'Not categorized',
  CATEGORIZING: 'Categorizing',
};

/** True when the list carries a filter only the Home dashboard sets. */
export function hasDrillFilters(filters: BankTransactionFilterParams) {
  return (
    (filters.cashFlows?.length ?? 0) > 0 ||
    Boolean(filters.baseAmount) ||
    (filters.categoryStatuses?.length ?? 0) > 0
  );
}
