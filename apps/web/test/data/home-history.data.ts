import type {Page, Route} from '@playwright/test';
import type {
  BankBalanceTrend,
  BankConnection,
  BankTransaction,
  BankTransactionBreakdown,
  BankTransactionBreakdownPart,
  BankTransactionBreakdownPeriod,
  BankTransactionCashFlow,
  BankTransactionReviewCounts,
  BankTransactionSummary,
  BankTransactionTotals,
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
 * €2,000 of spending a month, a €4,000 bonus in June 2025 and a €1,500 flight in March 2026, and
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
  sourceLabels?: Record<string, string>;
  /** Gives the employer the logo {@link EMPLOYER_LOGO}; specs that turn it on answer its image too. */
  sourceLogos?: boolean;
  /** `YYYY-MM` the history starts in; defaults to {@link HOME_FIRST_MONTH}. */
  firstMonth?: string;
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
/** The employer's logo with `sourceLogos`; the bonus never has one, so it shows its category's icon. */
export const EMPLOYER_LOGO = `/merchant-logos/00000000-0000-4000-8000-0000000000e1/${'e'.repeat(64)}`;
/** A 1×1 opaque PNG, synthetic, for {@link mockSourceLogo}. */
const LOGO_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

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

const sum = (values: Record<string, number>) => Object.values(values).reduce((a, b) => a + b, 0);

/** Every response Home and the month dialog read, consistent with each other. */
export function homeHistory(options: HomeHistoryOptions = {}) {
  const spendingOf = options.spending ?? defaultSpending;
  const incomeOf = options.income ?? defaultIncome;
  const firstMonth = options.firstMonth ?? HOME_FIRST_MONTH;
  const allMonths = monthsBetween(firstMonth, RUNNING);
  const sourceLabels: Record<string, string> = {
    [EMPLOYER]: 'Example Employer',
    [BONUS_SOURCE]: 'Example Bonus',
    ...options.sourceLabels,
  };
  let balance = 0;
  const balances = allMonths.map(
    (month) => (balance += sum(incomeOf(month)) - sum(spendingOf(month))),
  );

  const trend: BankBalanceTrend = {
    baseCurrency: 'EUR',
    interval: 'month',
    periods: allMonths.map((month, index) => ({
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
    periods: allMonths.map((month) => {
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
    looks: (key: string) => Partial<BankTransactionBreakdownPart> = () => ({}),
  ): BankTransactionBreakdownPeriod => ({
    start,
    end,
    complete,
    total: money(sum(amounts)),
    parts: Object.entries(amounts)
      .filter(([, amount]) => amount !== 0)
      .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
      .map(([key, amount]) => ({key, label: labelOf(key), amount: money(amount), ...looks(key)})),
  });
  const add = (into: Record<string, number>, from: Record<string, number>) => {
    for (const [key, amount] of Object.entries(from)) into[key] = (into[key] ?? 0) + amount;
    return into;
  };
  const years = [...new Set(allMonths.map((month) => month.slice(0, 4)))];
  const yearly = (
    of: (month: string) => Record<string, number>,
    labelOf: (key: string) => string,
    looks?: (key: string) => Partial<BankTransactionBreakdownPart>,
  ) =>
    years.map((year) => {
      const months = allMonths.filter((month) => month.startsWith(year));
      const amounts = months.reduce((into, month) => add(into, of(month)), {});
      const last = months[months.length - 1];
      return period(
        `${year}-01-01`,
        last === RUNNING ? HOME_TODAY : `${year}-12-31`,
        last !== RUNNING && !(year === firstMonth.slice(0, 4) && firstMonth !== `${year}-01`),
        amounts,
        labelOf,
        looks,
      );
    });
  const monthly = (
    of: (month: string) => Record<string, number>,
    labelOf: (key: string) => string,
    looks?: (key: string) => Partial<BankTransactionBreakdownPart>,
  ) =>
    allMonths.map((month) =>
      period(`${month}-01`, monthEnd(month), month !== RUNNING, of(month), labelOf, looks),
    );
  const category = (key: string) => key;
  const source = (key: string) => sourceLabels[key] ?? key;
  const sourceLooks = (key: string): Partial<BankTransactionBreakdownPart> => ({
    merchantLogoUrl: options.sourceLogos && key === EMPLOYER ? EMPLOYER_LOGO : null,
    category: key === EMPLOYER || key === BONUS_SOURCE ? 'INCOME' : null,
  });

  // Day by day, each month's rent lands on the 1st, the rest of its spending on the 15th and its income on the
  // 25th, so day ends meet the month ends above.
  const bookings = allMonths.flatMap((month) => {
    const spending = spendingOf(month);
    const rent = spending.HOUSING_AND_UTILITIES ?? 0;
    return [
      {date: `${month}-01`, amount: -rent},
      {date: `${month}-15`, amount: rent - sum(spending)},
      {date: `${month}-25`, amount: sum(incomeOf(month))},
    ];
  });
  const days = (from: string, to: string) => {
    const all: string[] = [];
    for (let date = new Date(`${from}T00:00:00Z`); date.toISOString().slice(0, 10) <= to;) {
      all.push(date.toISOString().slice(0, 10));
      date.setUTCDate(date.getUTCDate() + 1);
    }
    return all.filter((day) => day >= `${firstMonth}-01`);
  };
  /** The balance trend's `day` answer between two days. */
  const dayEnds = (from: string, to: string, asOf: string): BankBalanceTrend => ({
    baseCurrency: 'EUR',
    interval: 'day',
    periods: days(from, to).map((day) => {
      const total = money(
        bookings.filter((booking) => booking.date <= day).reduce((a, b) => a + b.amount, 0),
      );
      return {
        start: day,
        end: day,
        complete: day < asOf,
        total,
        accounts: [{id: '00000000-0000-4000-8000-0000000000a1', balance: total}],
      };
    }),
  });
  /** The totals of everything booked between two days. */
  const totalsBetween = (from: string, to: string): BankTransactionTotals => {
    const inRange = bookings.filter(
      (booking) => booking.date >= from && booking.date <= to && booking.amount !== 0,
    );
    const income = inRange.filter((b) => b.amount > 0).reduce((a, b) => a + b.amount, 0);
    const spending = -inRange.filter((b) => b.amount < 0).reduce((a, b) => a + b.amount, 0);
    return {
      baseCurrency: 'EUR',
      income: money(income),
      spending: money(spending),
      net: money(income - spending),
      count: inRange.length,
      excluded: {unknownDirection: 0, missingBaseAmount: 0},
    };
  };

  /**
   * The month summary at `asOf`: each category's spending and its usual over the 3 months before, by this day of
   * the month while it runs. Rent lands on the 1st and the rest of a month's spending on the 15th, as above.
   */
  const summaryOf = (month: string, asOf: string): BankTransactionSummary => {
    const through = month === asOf.slice(0, 7) ? asOf : `${month}-${pad(daysIn(month))}`;
    const throughDay = Number(through.slice(8));
    const byDay = (of: string) =>
      Object.fromEntries(
        Object.entries(spendingOf(of)).filter(
          ([key]) => throughDay >= (key === 'HOUSING_AND_UTILITIES' ? 1 : 15),
        ),
      );
    const baselineMonths = monthsBetween(firstMonth, month).slice(-4, -1);
    const spending = spendingOf(month);
    return {
      month,
      through,
      daysInMonth: daysIn(month),
      baseCurrency: 'EUR',
      totals: {
        spending: money(sum(spending)),
        income: money(sum(incomeOf(month))),
        net: money(sum(incomeOf(month)) - sum(spending)),
        ownTransfers: '0.00',
      },
      excluded: {unknownDirection: 0, missingBaseAmount: 0},
      daily: [],
      baseline: {
        months: baselineMonths,
        daily: [],
        spendingByThrough: null,
        spendingRangeByThrough: null,
        incomeByThrough: null,
      },
      categories: Object.entries(spending).map(([category, amount]) => ({
        category: category as BankTransactionSummary['categories'][number]['category'],
        spending: money(amount),
        count: 1,
        baselineAverage:
          baselineMonths.length === 0
            ? null
            : money(
                baselineMonths.reduce((total, of) => total + (byDay(of)[category] ?? 0), 0) /
                  baselineMonths.length,
              ),
      })),
    };
  };

  return {
    trend,
    flow,
    dayEnds,
    totalsBetween,
    summaryOf,
    breakdown: {
      year: {
        category: yearly(spendingOf, category),
        source: yearly(incomeOf, source, sourceLooks),
      },
      month: {
        category: monthly(spendingOf, category),
        source: monthly(incomeOf, source, sourceLooks),
      },
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
    monthlyEquivalent: amount,
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
  const brief = (item: RecurringSeries) => ({
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
    upcoming: [expenses[1], expenses[2], expenses[0]].map(brief),
    flagged: [expenses[1]].map(brief),
    expenseUnconvertedCount: 0,
    incomeUnconvertedCount: 0,
    baseCurrency: 'EUR',
  };
  return {lists, summary};
}

/**
 * Two to review, one failed and one without a direction, which is also one of the two to review: 3 rows need the
 * owner, the Transactions badge.
 */
export const HOME_REVIEW_COUNTS: BankTransactionReviewCounts = {
  needsReview: 2,
  categorizationFailed: 1,
  categorizing: 5,
  unknownDirection: 1,
  missingBaseAmount: 3,
  needsAttention: 3,
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

/** `count` synthetic payments booked in `month`, newest first; `page` answers one page of them. */
export function monthTransactions(
  month: string,
  count: number,
  page?: {index: number; size: number},
): BankTransactionsResponse {
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
  return {
    transactions: page
      ? transactions.slice(page.index * page.size, (page.index + 1) * page.size)
      : transactions,
    total: count,
  };
}

const params = (route: Route) => new URL(route.request().url()).searchParams;

/** Answers Home's history requests (balances, flows and breakdowns) from {@link homeHistory}. */
export async function mockHistoryEndpoints(page: Page, history: HomeHistory = homeHistory()) {
  await page.route('**/bank-transactions/balance-trend?**', (route) => {
    const query = params(route);
    return fulfillJson(
      route,
      query.get('interval') === 'day'
        ? history.dayEnds(query.get('from')!, query.get('to')!, query.get('asOf')!)
        : history.trend,
    );
  });
  await page.route('**/bank-transactions/totals?**', (route) => {
    const query = params(route);
    return fulfillJson(
      route,
      history.totalsBetween(
        query.get('filter[bookingDate][from]')!,
        query.get('filter[bookingDate][to]')!,
      ),
    );
  });
  await page.route('**/bank-transactions/cash-flow?**', (route) =>
    fulfillJson(route, history.flow),
  );
  await page.route('**/bank-transactions/summary?**', (route) =>
    fulfillJson(route, history.summaryOf(params(route).get('month')!, params(route).get('asOf')!)),
  );
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
    const pagination = {
      index: Number(params(route).get('pagination[pageIndex]') ?? 0),
      size: Number(params(route).get('pagination[pageSize]') ?? transactionsPerMonth),
    };
    return fulfillJson(
      route,
      from
        ? monthTransactions(from.slice(0, 7), transactionsPerMonth, pagination)
        : {transactions: [], total: 0},
    );
  });
}

/** Answers {@link EMPLOYER_LOGO}'s image, for histories built with `sourceLogos`. */
export async function mockSourceLogo(page: Page) {
  await page.route(`**${EMPLOYER_LOGO}/mask-v2`, (route) =>
    route.fulfill({status: 200, contentType: 'image/png', body: LOGO_PNG}),
  );
}
