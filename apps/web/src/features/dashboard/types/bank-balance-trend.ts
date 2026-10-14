import type {CashFlowInterval} from './bank-transaction-cash-flow';

/** Combined balance of the connected accounts at the end of one week, month or year. */
export type BalanceTrendPeriod = {
  /** First day: a Monday, the 1st, or 1 January. */
  start: string;
  /** The day the balances are for: the period's last day, or today while it is running. */
  end: string;
  /** False while the period is still running. */
  complete: boolean;
  /** Sum of the balances in the base currency; null when an account with history has no rate. */
  total: string | null;
  /** Every connected account; null before its history starts or without an exchange rate. */
  accounts: {id: string; balance: string | null}[];
};

export type BankBalanceTrend = {
  baseCurrency: string | null;
  interval: CashFlowInterval;
  /** Each connected account and the day its history in Tempo starts. */
  accounts: {id: string; since: string}[];
  periods: BalanceTrendPeriod[];
};
