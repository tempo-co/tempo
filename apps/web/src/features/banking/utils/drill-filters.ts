import type {
  BankTransactionCashFlowFilterValue,
  BankTransactionCategoryStatusFilterValue,
  BankTransactionFilterParams,
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

/** True when the list carries a filter Home's drill links can set. */
export function hasDrillFilters(filters: BankTransactionFilterParams) {
  return (
    (filters.cashFlows?.length ?? 0) > 0 ||
    Boolean(filters.baseAmount) ||
    (filters.categoryStatuses?.length ?? 0) > 0
  );
}
