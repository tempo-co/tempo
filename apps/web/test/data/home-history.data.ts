import type {Page, Route} from '@playwright/test';
import type {
  BankBalanceTrend,
  BankConnection,
  BankTransaction,
  BankTransactionBreakdown,
  BankTransactionBreakdownPeriod,
  BankTransactionCashFlow,
  BankTransactionEvent,
  BankTransactionEvents,
  BankTransactionReviewCounts,
  BankTransactionsResponse,
  MerchantRanking,
  RecurringSeries,
  RecurringSeriesLists,
  RecurringSummary,
} from '@tempo/contracts';

import {fulfillJson, mockBankConnections, mockJson} from '../utils/api-mocks';

export const HOME_CONNECTION: BankConnection = {
  id: '00000000-0000-4000-8000-0000000000c1',
  provider: 'enable-banking',
  aspspName: 'Example Bank',
  aspspCountry: 'NL',
  status: 'AUTHORIZED',
  consentValidUntil: '2027-06-01T00:00:00.000Z',
  lastSyncedAt: '2026-11-05T11:00:00.000Z',
  lastSyncError: null,
  nextSyncAt: '2026-11-05T17:00:00.000Z',
  syncStatus: 'SUCCEEDED',
  baseCurrency: 'EUR',
  bankAccounts: [
    {
      id: '00000000-0000-4000-8000-0000000000a1',
      name: 'Example Account Holder',
      alias: null,
      details: null,
      currency: 'EUR',
      cashAccountType: null,
      usage: null,
      maskedIdentifier: null,
      currentBalanceAmount: '24300.00',
      currentBalanceInBaseCurrency: '24300.00',
      baseCurrencyRateDate: null,
      currentBalanceType: null,
      balanceUpdatedAt: '2026-11-05T11:00:00.000Z',
      isActive: true,
      latestBalances: [],
    },
  ],
};

/**
 * A signed-in owner at {@link HOME_NOW} with one connected bank and {@link homeHistory}; fully mocked, so it
 * never reaches a shared API. Specs register narrower routes afterwards to change one answer.
 */
export async function mockSyntheticHome(
  page: Page,
  {
    history = homeHistory(),
    connections = [HOME_CONNECTION],
    reviewCounts = HOME_REVIEW_COUNTS,
    transactionsPerMonth,
    clock = 'fixed',
  }: {
    history?: HomeHistory;
    connections?: BankConnection[] | (() => BankConnection[]);
    reviewCounts?: BankTransactionReviewCounts;
    transactionsPerMonth?: number;
    /** `installed` controls timers too, for specs that run Home's refresh intervals forward. */
    clock?: 'fixed' | 'installed';
  } = {},
) {
  if (clock === 'installed') await page.clock.install({time: HOME_NOW});
  else await page.clock.setFixedTime(HOME_NOW);
  await mockJson(page, '**/accounts/me', {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Example Owner',
    email: 'owner@example.com',
    isEmailVerified: true,
  });
  // The bank synced moments ago (204), so opening Tempo reloads nothing and request counts stay exact.
  await page.route('**/bank-connections/*/refresh', (route) => route.fulfill({status: 204}));
  await mockBankConnections(page, connections);
  await mockJson(page, '**/bank-transactions/review-counts', reviewCounts);
  await mockHomeHistory(page, history, {transactionsPerMonth});
}

/**
 * A synthetic history for Home, every value made up: from December 2024 to 5 November 2026, €3,000 of income and
 * €2,000 of spending a month, a €4,000 bonus in June 2025 and a €1,500 flight in March 2026 (both one-offs), and
 * the running month with only the rent so far. The balance starts at zero, so each month end is the sum of what
 * was kept: €24,300 today, €15,000 at the end of October 2025.
 */
export const HOME_NOW = new Date('2026-11-05T12:00:00.000Z');
export const HOME_TODAY = '2026-11-05';
export const HOME_FIRST_MONTH = '2024-12';

/** A usual month's spending by category. */
export const USUAL_SPENDING = {
  HOUSING_AND_UTILITIES: 1200,
  FOOD_AND_DRINK: 500,
  SHOPPING: 200,
  TRANSPORTATION: 60,
  ENTERTAINMENT: 30,
  HEALTH: 10,
} as const;

export const BONUS = {month: '2025-06', date: '2025-06-20', amount: 4000};
export const FLIGHT = {month: '2026-03', date: '2026-03-12', amount: 1500};

export type HomeHistoryOptions = {
  /** Category spending per month; defaults to {@link USUAL_SPENDING} (the running month has only rent). */
  spending?: (month: string) => Record<string, number>;
  /** Income per source and month; defaults to the employer's €3,000 plus the bonus. */
  income?: (month: string) => Record<string, number>;
  events?: BankTransactionEvent[];
  sourceLabels?: Record<string, string>;
};

const pad = (value: number) => String(value).padStart(2, '0');
const money = (euros: number) => euros.toFixed(2);

export function monthsBetween(from: string, to: string) {
  const months: string[] = [];
  for (let date = new Date(`${from}-01T00:00:00Z`); date.toISOString().slice(0, 7) <= to;) {
    months.push(date.toISOString().slice(0, 7));
    date.setUTCMonth(date.getUTCMonth() + 1);
  }
  return months;
}

const daysIn = (month: string) =>
  new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
const monthEnd = (month: string) =>
  month === HOME_TODAY.slice(0, 7) ? HOME_TODAY : `${month}-${pad(daysIn(month))}`;

export const HOME_MONTHS = monthsBetween(HOME_FIRST_MONTH, HOME_TODAY.slice(0, 7));
const RUNNING = HOME_TODAY.slice(0, 7);

export const EMPLOYER = 'INCOME:example employer';
export const BONUS_SOURCE = 'INCOME:example bonus';

const defaultSpending = (month: string): Record<string, number> => {
  if (month === RUNNING) return {HOUSING_AND_UTILITIES: 1200};
  return month === FLIGHT.month ? {...USUAL_SPENDING, TRAVEL: FLIGHT.amount} : {...USUAL_SPENDING};
};
const defaultIncome = (month: string): Record<string, number> => {
  if (month === RUNNING) return {};
  return month === BONUS.month
    ? {[EMPLOYER]: 3000, [BONUS_SOURCE]: BONUS.amount}
    : {[EMPLOYER]: 3000};
};

export const HOME_EVENTS: BankTransactionEvent[] = [
  {
    id: '00000000-0000-4000-8000-00000000e001',
    date: BONUS.date,
    name: 'Example Bonus',
    category: 'INCOME',
    direction: 'INCOME',
    amount: money(BONUS.amount),
    usualMonth: '2000.00',
    share: 2,
  },
  {
    id: '00000000-0000-4000-8000-00000000e002',
    date: FLIGHT.date,
    name: 'Example Airline',
    category: 'TRAVEL',
    direction: 'EXPENSE',
    amount: money(FLIGHT.amount),
    usualMonth: '2000.00',
    share: 0.75,
  },
];

const sum = (values: Record<string, number>) => Object.values(values).reduce((a, b) => a + b, 0);

/** Every response Home and the month dialog read, consistent with each other. */
export function homeHistory(options: HomeHistoryOptions = {}) {
  const spendingOf = options.spending ?? defaultSpending;
  const incomeOf = options.income ?? defaultIncome;
  const events = options.events ?? HOME_EVENTS;
  const sourceLabels: Record<string, string> = {
    [EMPLOYER]: 'Example Employer',
    [BONUS_SOURCE]: 'Example Bonus',
    ...options.sourceLabels,
  };
  let balance = 0;
  const balances = HOME_MONTHS.map(
    (month) => (balance += sum(incomeOf(month)) - sum(spendingOf(month))),
  );

  const trend: BankBalanceTrend = {
    baseCurrency: 'EUR',
    interval: 'month',
    periods: HOME_MONTHS.map((month, index) => ({
      start: `${month}-01`,
      end: monthEnd(month),
      complete: month !== RUNNING,
      total: money(balances[index]),
      accounts: [{id: '00000000-0000-4000-8000-0000000000a1', balance: money(balances[index])}],
    })),
  };
  const flow: BankTransactionCashFlow = {
    baseCurrency: 'EUR',
    interval: 'month',
    periods: HOME_MONTHS.map((month) => {
      const income = sum(incomeOf(month));
      const spending = sum(spendingOf(month));
      return {
        start: `${month}-01`,
        end: monthEnd(month),
        complete: month !== RUNNING,
        income: money(income),
        spending: money(spending),
        net: money(income - spending),
      };
    }),
  };

  const period = (
    start: string,
    end: string,
    complete: boolean,
    amounts: Record<string, number>,
    labelOf: (key: string) => string,
  ): BankTransactionBreakdownPeriod => ({
    start,
    end,
    complete,
    total: money(sum(amounts)),
    parts: Object.entries(amounts)
      .filter(([, amount]) => amount !== 0)
      .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
      .map(([key, amount]) => ({key, label: labelOf(key), amount: money(amount)})),
  });
  const add = (into: Record<string, number>, from: Record<string, number>) => {
    for (const [key, amount] of Object.entries(from)) into[key] = (into[key] ?? 0) + amount;
    return into;
  };
  const years = [...new Set(HOME_MONTHS.map((month) => month.slice(0, 4)))];
  const yearly = (
    of: (month: string) => Record<string, number>,
    labelOf: (key: string) => string,
  ) =>
    years.map((year) => {
      const months = HOME_MONTHS.filter((month) => month.startsWith(year));
      const amounts = months.reduce((into, month) => add(into, of(month)), {});
      const last = months[months.length - 1];
      return period(
        `${year}-01-01`,
        last === RUNNING ? HOME_TODAY : `${year}-12-31`,
        last !== RUNNING &&
          !(year === HOME_FIRST_MONTH.slice(0, 4) && HOME_FIRST_MONTH !== `${year}-01`),
        amounts,
        labelOf,
      );
    });
  const monthly = (
    of: (month: string) => Record<string, number>,
    labelOf: (key: string) => string,
  ) =>
    HOME_MONTHS.map((month) =>
      period(`${month}-01`, monthEnd(month), month !== RUNNING, of(month), labelOf),
    );
  const category = (key: string) => key;
  const source = (key: string) => sourceLabels[key] ?? key;

  return {
    trend,
    flow,
    events: {baseCurrency: 'EUR', events} satisfies BankTransactionEvents,
    breakdown: {
      year: {category: yearly(spendingOf, category), source: yearly(incomeOf, source)},
      month: {category: monthly(spendingOf, category), source: monthly(incomeOf, source)},
    },
    balances,
  };
}

export type HomeHistory = ReturnType<typeof homeHistory>;

const RECURRING_SERIES_BASE = {
  direction: 'EXPENSE',
  cadence: 'MONTHLY',
  amountKind: 'FIXED',
  currency: 'EUR',
  monthlyEquivalent: null,
  amountRange: null,
  recentPayments: [],
  transactionCount: 12,
  firstDate: '2025-01-01',
  lastDate: '2026-10-01',
  status: 'ACTIVE',
  flags: [],
  priceChange: null,
  hidden: false,
  continuation: null,
  category: 'HOUSING_AND_UTILITIES',
  merchantLogoUrl: null,
} satisfies Partial<RecurringSeries>;

export const RENT_KEY = 'a1'.repeat(16);
export const ENERGY_KEY = 'b2'.repeat(16);
export const PHONE_KEY = 'c3'.repeat(16);

/** Bills of €1,250 and income of €3,000 a month; the energy bill is late. */
export function homeRecurring() {
  const series = (
    key: string,
    name: string,
    amount: string,
    extra: Partial<RecurringSeries> = {},
  ) => ({
    ...RECURRING_SERIES_BASE,
    key,
    name,
    typicalAmount: amount,
    latestAmount: amount,
    nextExpectedDate: '2026-12-01',
    ...extra,
  });
  const expenses = [
    series(RENT_KEY, 'Example Landlord', '1200.00', {nextExpectedDate: '2026-12-01'}),
    series(ENERGY_KEY, 'Example Energy', '35.00', {
      nextExpectedDate: '2026-11-03',
      flags: ['LATE'],
    }),
    series(PHONE_KEY, 'Example Mobile', '15.00', {nextExpectedDate: '2026-11-14'}),
  ];
  const lists: RecurringSeriesLists = {
    expenses: {
      series: expenses,
      monthlyTotal: '1250.00',
      unconvertedCount: 0,
      thisMonth: {month: '2026-11', paid: '1200.00', remaining: '50.00'},
      baseCurrency: 'EUR',
    },
    income: {
      series: [],
      monthlyTotal: '3000.00',
      unconvertedCount: 0,
      thisMonth: {month: '2026-11', paid: '0.00', remaining: '3000.00'},
      baseCurrency: 'EUR',
    },
  };
  const upcoming = (item: RecurringSeries) => ({
    key: item.key,
    name: item.name,
    direction: item.direction,
    nextExpectedDate: item.nextExpectedDate,
    typicalAmount: item.typicalAmount,
    amountKind: item.amountKind,
    currency: item.currency,
    category: item.category,
    merchantLogoUrl: item.merchantLogoUrl,
    flags: item.flags,
  });
  const summary: RecurringSummary = {
    expenseMonthlyTotal: '1250.00',
    incomeMonthlyTotal: '3000.00',
    expenseThisMonth: lists.expenses.thisMonth,
    incomeThisMonth: lists.income.thisMonth,
    upcoming: [expenses[1], expenses[2], expenses[0]].map(upcoming),
    expenseUnconvertedCount: 0,
    incomeUnconvertedCount: 0,
    baseCurrency: 'EUR',
  };
  return {lists, summary};
}

/** Two to review, one failed and one without a direction: 4 on the Transactions badge. */
export const HOME_REVIEW_COUNTS: BankTransactionReviewCounts = {
  needsReview: 2,
  categorizationFailed: 1,
  categorizing: 5,
  unknownDirection: 1,
  missingBaseAmount: 3,
};

export const MARKET_ID = `k_${'d4'.repeat(16)}`;

export function homeRanking(period: string): MerchantRanking {
  return {
    baseCurrency: 'EUR',
    interval: 'month',
    start: period,
    end: period,
    through: period,
    baselinePeriods: [],
    merchants: [
      {
        id: `k_${'e5'.repeat(16)}`,
        name: 'Example Landlord',
        kind: 'MERCHANT',
        logoUrl: null,
        spent: '1200.00',
        count: 1,
        usual: null,
        change: null,
      },
      {
        id: MARKET_ID,
        name: 'Example Market',
        kind: 'MERCHANT',
        logoUrl: null,
        spent: '500.00',
        count: 9,
        usual: null,
        change: null,
      },
    ],
    total: 2,
  };
}

/** `count` synthetic payments booked in `month`, newest first. */
export function monthTransactions(month: string, count: number): BankTransactionsResponse {
  const transactions = Array.from({length: count}, (_, index) => {
    const day = `${month}-${pad(Math.max(1, 28 - index))}`;
    return {
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      transactionDate: day,
      bookingDate: day,
      valueDate: day,
      description: `Example Shop ${index + 1}`,
      displayDescription: `Example Shop ${index + 1}`,
      merchantLogoUrl: null,
      merchantGroupId: null,
      counterpartyName: null,
      amount: '-10.00',
      currency: 'EUR',
      creditDebitIndicator: 'DBIT',
      direction: 'EXPENSE',
      transactionType: 'CARD_PAYMENT',
      transactionStatus: 'BOOK',
      category: 'SHOPPING',
      categoryStatus: 'COMPLETED',
      categorySource: 'AI',
      financialEventType: null,
      financialEventSource: null,
      financialEventRuleVersion: null,
      cashFlowTreatment: 'EXPENSE',
      ownTransfer: null,
      ownTransferOverride: null,
      currencyExchangeCounterpart: null,
      categoryConfidence: null,
      providerTransactionDescription: null,
      merchantCategoryCode: null,
      remittanceInformation: null,
      balanceAfterAmount: null,
      balanceAfterCurrency: null,
      instructedAmount: null,
      instructedCurrency: null,
      exchangeRate: null,
      exchangeRateUnitCurrency: null,
      exchangeRateType: null,
      amountInBaseCurrency: '-10.00',
      baseAmountMethod: null,
      baseAmountRateDate: null,
      referenceNumber: null,
      referenceNumberScheme: null,
      bankName: 'Example Bank',
      bankCountry: 'NL',
      bankAccountName: 'Main account',
      bankAccountAlias: null,
      bankAccountId: '00000000-0000-4000-8000-0000000000a1',
    } as unknown as BankTransaction;
  });
  return {transactions, total: count};
}

const params = (route: Route) => new URL(route.request().url()).searchParams;

/** Answers Home's history requests (balances, flows, one-offs and breakdowns) from {@link homeHistory}. */
export async function mockHistoryEndpoints(page: Page, history: HomeHistory = homeHistory()) {
  await page.route('**/bank-transactions/balance-trend?**', (route) =>
    fulfillJson(route, history.trend),
  );
  await page.route('**/bank-transactions/cash-flow?**', (route) =>
    fulfillJson(route, history.flow),
  );
  await page.route('**/bank-transactions/events?**', (route) => fulfillJson(route, history.events));
  await page.route('**/bank-transactions/breakdown?**', (route) => {
    const interval = params(route).get('interval') as 'year' | 'month';
    const by = params(route).get('by') as 'category' | 'source';
    return fulfillJson(route, {
      baseCurrency: 'EUR',
      interval,
      by,
      periods: history.breakdown[interval][by],
    } satisfies BankTransactionBreakdown);
  });
}

/** Answers every request Home and its month dialog make from {@link homeHistory}. */
export async function mockHomeHistory(
  page: Page,
  history: HomeHistory = homeHistory(),
  {transactionsPerMonth = 15}: {transactionsPerMonth?: number} = {},
) {
  await mockHistoryEndpoints(page, history);
  const recurring = homeRecurring();
  await page.route('**/recurring-series/summary?**', (route) =>
    fulfillJson(route, recurring.summary),
  );
  await page.route('**/recurring-series?**', (route) => fulfillJson(route, recurring.lists));
  await page.route('**/merchants/ranking?**', (route) =>
    fulfillJson(route, homeRanking(params(route).get('period') ?? '')),
  );
  await page.route('**/bank-transactions?**', (route) => {
    if (!['fetch', 'xhr'].includes(route.request().resourceType())) return route.continue();
    const from = params(route).get('filter[bookingDate][from]');
    return fulfillJson(
      route,
      from
        ? monthTransactions(from.slice(0, 7), transactionsPerMonth)
        : {transactions: [], total: 0},
    );
  });
}
