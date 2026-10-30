import {Page, Route} from '@playwright/test';
import type {
  BankBalanceTrend,
  BankConnection,
  BankTransactionCashFlow,
  BankTransactionReviewCounts,
  BankTransactionSummary,
  RecurringSummary,
} from '@tempo/contracts';

import {successfulBankRefresh} from '../data/bank-sync-run.data';

export function fulfillJson(route: Route, body: unknown, status = 200) {
  return route.fulfill({status, contentType: 'application/json', body: JSON.stringify(body)});
}

/** Sends a navigation on to `location`; WebKit refuses to fulfill a mocked 3xx. */
export function fulfillRedirect(route: Route, location: string) {
  return route.fulfill({
    contentType: 'text/html',
    body: `<script>location.replace(${JSON.stringify(location)})</script>`,
  });
}

/** Synthetic monthly totals for specs that mock Home without a real session. */
export const syntheticCashFlow = {
  baseCurrency: 'EUR',
  interval: 'month',
  periods: ['2026-07', '2026-08', '2026-09'].map((month, index) => ({
    start: `${month}-01`,
    end: `${month}-${month === '2026-09' ? '30' : '31'}`,
    complete: true,
    spending: `${1100 + index * 50}.00`,
    income: '2500.00',
    net: `${1400 - index * 50}.00`,
  })),
};

/** Serves {@link syntheticCashFlow} for every interval, so the card never reaches the real API. */
export function mockCashFlow(page: Page) {
  return page.route('**/bank-transactions/cash-flow**', (route) => {
    const interval = new URL(route.request().url()).searchParams.get('interval');
    return fulfillJson(route, {...syntheticCashFlow, interval});
  });
}

/** Synthetic month-end balances for specs that mock Home without a real session. */
const syntheticBalanceTrend = {
  baseCurrency: 'EUR',
  interval: 'month',
  periods: ['2026-07', '2026-08', '2026-09'].map((month, index) => ({
    start: `${month}-01`,
    end: `${month}-${month === '2026-09' ? '30' : '31'}`,
    complete: true,
    total: `${4000 + index * 250}.00`,
    accounts: [{id: '00000000-0000-4000-8000-000000000001', balance: `${4000 + index * 250}.00`}],
  })),
};

/** Serves {@link syntheticBalanceTrend} for every interval, so the card never reaches the real API. */
export function mockBalanceTrend(page: Page) {
  return page.route('**/bank-transactions/balance-trend**', (route) => {
    const interval = new URL(route.request().url()).searchParams.get('interval');
    return fulfillJson(route, {...syntheticBalanceTrend, interval});
  });
}

/** Answers every request to `url` with the same JSON response. */
export function mockJson(page: Page, url: string, body: unknown, status = 200) {
  return page.route(url, (route) => fulfillJson(route, body, status));
}

/** Completes a foreground refresh without changing the synthetic saved data. */
export function mockBankRefresh(page: Page) {
  return mockJson(page, '**/bank-connections/*/refresh', successfulBankRefresh);
}

/**
 * Intercepts the API's `GET /bank-connections` request. Page navigations to `/bank-connections`
 * share the URL pattern, so they are passed through.
 */
export function routeBankConnectionsApi(page: Page, handler: (route: Route) => Promise<void>) {
  return page.route('**/bank-connections', async (route) => {
    if (route.request().resourceType() === 'document') {
      await route.continue();
      return;
    }
    await handler(route);
  });
}

/** Serves fixed connections, or connections computed per request (for example to count polls). */
export function mockBankConnections(
  page: Page,
  connections: BankConnection[] | (() => BankConnection[]),
) {
  return routeBankConnectionsApi(page, (route) =>
    fulfillJson(route, typeof connections === 'function' ? connections() : connections),
  );
}

/** Serves the seeded connections after `transform` changes them. */
export function transformBankConnections(
  page: Page,
  transform: (connections: BankConnection[]) => unknown,
) {
  return routeBankConnectionsApi(page, async (route) => {
    const response = await route.fetch();
    const connections = (await response.json()) as BankConnection[];
    await route.fulfill({response, json: transform(connections)});
  });
}

/**
 * Answers Home's card requests with empty data. Home requests its cards while the connections load,
 * so a fully mocked spec that opens Home without banks still sends them.
 */
export async function mockEmptyHome(page: Page) {
  const interval = (route: Route) =>
    new URL(route.request().url()).searchParams.get(
      'interval',
    ) as BankTransactionCashFlow['interval'];
  await page.route('**/bank-transactions/summary?**', (route) => {
    const params = new URL(route.request().url()).searchParams;
    return fulfillJson(route, {
      month: params.get('month') ?? '',
      through: params.get('asOf') ?? '',
      daysInMonth: 30,
      baseCurrency: null,
      totals: {spending: '0.00', income: '0.00', net: '0.00', ownTransfers: '0.00'},
      excluded: {unknownDirection: 0, missingBaseAmount: 0},
      daily: [],
      baseline: {
        months: [],
        daily: [],
        spendingByThrough: null,
        spendingRangeByThrough: null,
        incomeByThrough: null,
      },
      categories: [],
    } satisfies BankTransactionSummary);
  });
  await page.route('**/bank-transactions/cash-flow?**', (route) =>
    fulfillJson(route, {
      baseCurrency: null,
      interval: interval(route),
      periods: [],
    } satisfies BankTransactionCashFlow),
  );
  await page.route('**/bank-transactions/balance-trend?**', (route) =>
    fulfillJson(route, {
      baseCurrency: null,
      interval: interval(route),
      periods: [],
    } satisfies BankBalanceTrend),
  );
  await mockJson(page, '**/bank-transactions/review-counts', {
    needsReview: 0,
    categorizationFailed: 0,
    categorizing: 0,
    unknownDirection: 0,
    missingBaseAmount: 0,
  } satisfies BankTransactionReviewCounts);
  await mockJson(page, '**/recurring-series/summary?**', {
    expenseMonthlyTotal: '0.00',
    incomeMonthlyTotal: '0.00',
    upcoming: [],
    expenseUnconvertedCount: 0,
    incomeUnconvertedCount: 0,
    baseCurrency: null,
    expenseThisMonth: {month: '', paid: '0.00', remaining: '0.00'},
    incomeThisMonth: {month: '', paid: '0.00', remaining: '0.00'},
  } satisfies RecurringSummary);
  await page.route('**/bank-transactions?**', (route) =>
    ['fetch', 'xhr'].includes(route.request().resourceType())
      ? fulfillJson(route, {transactions: [], total: 0})
      : route.continue(),
  );
}
