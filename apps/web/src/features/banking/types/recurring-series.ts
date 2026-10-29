import type {BankTransactionCategory} from './bank-transaction';

export const RECURRING_CADENCES = [
  'WEEKLY',
  'FOUR_WEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'YEARLY',
] as const;
export type RecurringCadence = (typeof RECURRING_CADENCES)[number];

export type RecurringSeriesDirection = 'EXPENSE' | 'INCOME';

/** The earlier history a series continues: joined with it, or kept apart because the owner unlinked them. */
export type RecurringContinuation = {
  previousName: string;
  previousFirstDate: string;
  previousLastDate: string;
  linked: boolean;
};

/** A fixed price's recent change: `amount` is signed, `since` is the first payment at the new price. */
export type RecurringPriceChange = {
  amount: string;
  since: string;
};

export type RecurringPayment = {date: string; amount: string};

/** A detected series of payments. Amounts are positive two-decimal strings. */
export type RecurringSeries = {
  key: string;
  name: string;
  direction: RecurringSeriesDirection;
  cadence: RecurringCadence;
  amountKind: 'FIXED' | 'VARIABLE';
  currency: string;
  /** A fixed price, or the median of a variable amount's recent payments. */
  typicalAmount: string;
  latestAmount: string;
  /**
   * This month's cost in the owner's base currency: the usual amount, or what a variable monthly bill was paid this
   * month. Null until every payment has a converted amount.
   */
  monthlyEquivalent: string | null;
  /** A variable amount's lowest and highest recent payment. */
  amountRange: {low: string; high: string} | null;
  /** A variable amount's recent payments, oldest first; empty for a fixed price. */
  recentPayments: RecurringPayment[];
  transactionCount: number;
  firstDate: string;
  lastDate: string;
  nextExpectedDate: string;
  status: 'ACTIVE' | 'ENDED';
  flags: Array<'LATE' | 'HIGHER_THAN_USUAL'>;
  priceChange: RecurringPriceChange | null;
  /** Marked as not recurring by the owner; left out of totals. */
  hidden: boolean;
  continuation: RecurringContinuation | null;
  /** The latest payment's category. */
  category: BankTransactionCategory | null;
  /** Path of the latest payment's merchant logo on the API; null without a trusted logo. */
  merchantLogoUrl: string | null;
};

/**
 * One direction's calendar month in the base currency: what its counted series paid so far, and
 * their usual amount for each payment still expected before it ends, late ones included.
 */
export type RecurringThisMonth = {month: string; paid: string; remaining: string};

export type RecurringSeriesList = {
  series: RecurringSeries[];
  monthlyTotal: string;
  unconvertedCount: number;
  baseCurrency: string | null;
  thisMonth: RecurringThisMonth;
};

/** Bills and income, from one read. */
export type RecurringSeriesLists = {
  expenses: RecurringSeriesList;
  income: RecurringSeriesList;
};

export type RecurringUpcomingPayment = Pick<
  RecurringSeries,
  | 'key'
  | 'name'
  | 'direction'
  | 'nextExpectedDate'
  | 'typicalAmount'
  | 'amountKind'
  | 'currency'
  | 'category'
  | 'merchantLogoUrl'
  | 'flags'
>;

export type RecurringSummary = {
  expenseMonthlyTotal: string;
  incomeMonthlyTotal: string;
  upcoming: RecurringUpcomingPayment[];
  expenseUnconvertedCount: number;
  incomeUnconvertedCount: number;
  baseCurrency: string | null;
  /** The bills and income lists' `thisMonth`. */
  expenseThisMonth: RecurringThisMonth;
  incomeThisMonth: RecurringThisMonth;
};

export const RECURRING_CADENCE_LABELS: Record<RecurringCadence, string> = {
  WEEKLY: 'Weekly',
  FOUR_WEEKLY: 'Every 4 weeks',
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  YEARLY: 'Yearly',
};
