export type CashFlowInterval = 'week' | 'month' | 'year';

/** One week, month or year of spending and income in the owner's base currency, as two-decimal strings. */
export type CashFlowPeriod = {
  /** First day: a Monday, the 1st, or 1 January. */
  start: string;
  /** Last day counted: the period's last day, or today while it is still running. */
  end: string;
  /** False while the period is running, or when history starts partway through it. */
  complete: boolean;
  spending: string;
  income: string;
  net: string;
};

/** Totals per period, oldest first, on the Home summary's definitions. */
export type BankTransactionCashFlow = {
  baseCurrency: string | null;
  interval: CashFlowInterval;
  periods: CashFlowPeriod[];
};
