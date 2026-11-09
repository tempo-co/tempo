import {Locator, Page, Route, expect} from '@playwright/test';
import type {
  BankBalanceTrend,
  BankConnection,
  BankTransactionBreakdown,
  BankTransactionCashFlow,
  BankTransactionReviewCounts,
  BankTransactionSummary,
  MerchantRanking,
  RecurringSeriesLists,
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

/**
 * Fails the API reads of `url` that `isLater` picks (a paged list's later pages) with a final error until
 * `failing` is turned off; every other read goes on to the mocks behind. `pages` records each later page asked
 * for, failed or not, by what `isLater` returns for it.
 */
export async function failLaterPages(
  page: Page,
  url: string,
  isLater: (params: URLSearchParams) => string | null,
) {
  const state = {failing: true, pages: [] as string[]};
  await page.route(url, (route) => {
    const request = route.request();
    const later = ['fetch', 'xhr'].includes(request.resourceType())
      ? isLater(new URL(request.url()).searchParams)
      : null;
    if (later === null) return route.fallback();
    state.pages.push(later);
    // 429 is final, so the query does not retry it on its own.
    if (state.failing) return fulfillJson(route, {message: 'Too Many Requests'}, 429);
    return route.fallback();
  });
  return state;
}

/**
 * Presses `scope`'s Load more while {@link failLaterPages} fails the next page: the `loaded` rows stay with a note
 * under them, and Retry asks for the same page again and adds its rows, `after` in all.
 */
export async function expectFailedPageRetried(
  scope: Locator,
  rows: Locator,
  later: Awaited<ReturnType<typeof failLaterPages>>,
  {loaded, after}: {loaded: number; after: number},
) {
  await expect(rows).toHaveCount(loaded);
  await scope.getByRole('button', {name: 'Load more'}).click();
  const note = scope.getByRole('status').filter({hasText: "Couldn't load more."});
  await expect(note).toBeVisible();
  await expect(rows).toHaveCount(loaded);
  await expect(scope.getByRole('button', {name: 'Load more'})).toHaveCount(0);
  expect(later.pages).toHaveLength(1);

  later.failing = false;
  await scope.getByRole('button', {name: 'Retry'}).click();
  await expect(rows).toHaveCount(after);
  await expect(note).toHaveCount(0);
  expect(later.pages).toEqual([later.pages[0], later.pages[0]]);
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

/** Review counts with nothing waiting for the owner, so the navigation carries no badge. */
export const EMPTY_REVIEW_COUNTS: BankTransactionReviewCounts = {
  needsReview: 0,
  categorizationFailed: 0,
  categorizing: 0,
  unknownDirection: 0,
  missingBaseAmount: 0,
  needsAttention: 0,
};

/**
 * Answers Home's requests, and the navigation's review counts, with empty data. Home requests its
 * history while the connections load, so a fully mocked spec that opens Home without banks still
 * sends them.
 */
export async function mockEmptyHome(page: Page) {
  // Registered by the fully mocked fixture before each spec's more specific routes.
  await mockJson(page, '**/bank-transactions/*/recurring?**', null);
  const interval = (route: Route) =>
    new URL(route.request().url()).searchParams.get(
      'interval',
    ) as BankTransactionCashFlow['interval'];
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
  await page.route('**/bank-transactions/breakdown?**', (route) => {
    const params = new URL(route.request().url()).searchParams;
    return fulfillJson(route, {
      baseCurrency: null,
      interval: params.get('interval') as BankTransactionBreakdown['interval'],
      by: params.get('by') as BankTransactionBreakdown['by'],
      periods: [],
    } satisfies BankTransactionBreakdown);
  });
  await mockJson(page, '**/bank-transactions/review-counts', EMPTY_REVIEW_COUNTS);
  await page.route('**/bank-transactions/summary?**', (route) => {
    const params = new URL(route.request().url()).searchParams;
    const month = params.get('month') ?? '';
    return fulfillJson(route, {
      month,
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
  await mockJson(page, '**/recurring-series/summary?**', {
    expenseMonthlyTotal: '0.00',
    incomeMonthlyTotal: '0.00',
    upcoming: [],
    flagged: [],
    expenseUnconvertedCount: 0,
    incomeUnconvertedCount: 0,
    baseCurrency: null,
    expenseThisMonth: {month: '', paid: '0.00', remaining: '0.00'},
    incomeThisMonth: {month: '', paid: '0.00', remaining: '0.00'},
  } satisfies RecurringSummary);
  await mockEmptyRecurringLists(page);
  await page.route('**/bank-transactions?**', (route) =>
    ['fetch', 'xhr'].includes(route.request().resourceType())
      ? fulfillJson(route, {transactions: [], total: 0})
      : route.continue(),
  );
  await mockMerchantRanking(page);
}

/** Answers the recurring lists (the recurring dialog) with none. */
export function mockEmptyRecurringLists(page: Page) {
  const empty = {
    series: [],
    monthlyTotal: '0.00',
    unconvertedCount: 0,
    thisMonth: {month: '', paid: '0.00', remaining: '0.00'},
    baseCurrency: null,
  };
  return mockJson(page, '**/recurring-series?**', {
    expenses: empty,
    income: empty,
  } satisfies RecurringSeriesLists);
}

/** Answers the merchant ranking (the month's biggest merchants) with an empty ranking. */
export function mockMerchantRanking(page: Page) {
  return page.route('**/merchants/ranking?**', (route) => {
    const params = new URL(route.request().url()).searchParams;
    return fulfillJson(route, {
      baseCurrency: null,
      interval: params.get('interval') as MerchantRanking['interval'],
      start: params.get('period') ?? '',
      end: params.get('period') ?? '',
      through: params.get('period') ?? '',
      baselinePeriods: [],
      merchants: [],
      total: 0,
    } satisfies MerchantRanking);
  });
}
