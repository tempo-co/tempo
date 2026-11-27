import type {Page} from '@playwright/test';

import {
  HOME_REVIEW_COUNTS,
  USUAL_SPENDING,
  homeHistory,
  mockSyntheticHome,
} from '../../data/home-history.data';
import {expect, test} from '../../fixtures';
import {fulfillJson} from '../../utils/api-mocks';

test.use({storageState: {cookies: [], origins: []}, timezoneId: 'Europe/Amsterdam'});

/**
 * Late categorization or conversion changes Home's figures without any sync status change: once `enriched`,
 * November's rent is €400 higher and nothing is left to review.
 */
async function mockDerivedData(page: Page) {
  const state = {enriched: false, reads: {pace: 0, categories: 0, review: 0}};
  const before = homeHistory();
  const after = homeHistory({
    spending: (month) =>
      month === '2026-11'
        ? {HOUSING_AND_UTILITIES: 1600}
        : {...USUAL_SPENDING, ...(month === '2026-03' ? {TRAVEL: 1500} : {})},
  });
  await mockSyntheticHome(page, {history: before, clock: 'installed'});
  const current = () => (state.enriched ? after : before);
  await page.route('**/bank-transactions/spending-pace?**', (route) => {
    state.reads.pace++;
    return fulfillJson(
      route,
      current().paceOf(new URL(route.request().url()).searchParams.get('asOf')!),
    );
  });
  await page.route('**/bank-transactions/breakdown?**', (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get('interval') !== 'month' || params.get('by') !== 'category')
      return route.fallback();
    state.reads.categories++;
    return fulfillJson(route, {
      baseCurrency: 'EUR',
      interval: 'month',
      by: 'category',
      periods: current().breakdown.month.category,
    });
  });
  await page.route('**/bank-transactions/review-counts', (route) => {
    state.reads.review++;
    return fulfillJson(
      route,
      state.enriched
        ? {
            ...HOME_REVIEW_COUNTS,
            needsReview: 0,
            categorizationFailed: 0,
            needsAttention: 0,
          }
        : HOME_REVIEW_COUNTS,
    );
  });
  return state;
}

test('Home refreshes its figures and the review badge every 30 seconds while visible', async ({
  page,
  homePage,
}) => {
  const state = await mockDerivedData(page);
  await page.goto('/');
  await expect(homePage.paceFigure).toHaveText('€1,200');
  await expect(page.getByRole('link', {name: 'Transactions, 3 to check'}).first()).toBeVisible();
  await expect.poll(() => state.reads).toEqual({pace: 1, categories: 1, review: 1});

  state.enriched = true;
  await page.clock.runFor(29_000);
  expect(state.reads).toEqual({pace: 1, categories: 1, review: 1});
  await page.clock.runFor(1_500);
  await expect(homePage.paceFigure).toHaveText('€1,600');
  await expect(page.getByRole('link', {name: 'Transactions', exact: true}).first()).toBeVisible();
  await expect.poll(() => state.reads).toEqual({pace: 2, categories: 2, review: 2});
  // A background refresh keeps the rendered cards instead of flashing skeletons.
  await expect(homePage.accountsTotal).toHaveText('€24,300.00');
});

test('a month viewed in the last 30 seconds opens again from cache', async ({page, homePage}) => {
  await mockSyntheticHome(page);
  const reads: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/bank-transactions') || path.endsWith('/merchants/ranking'))
      reads.push(path);
  });
  await page.goto('/insights/months/2026-09');
  const transactions = (title: string) =>
    homePage.monthPage(title).getByRole('region', {name: 'Transactions'}).getByRole('listitem');
  await expect(transactions('September 2026')).toHaveCount(15);
  await expect.poll(() => reads.length).toBe(2);

  await page.getByRole('button', {name: 'Previous month'}).click();
  await expect(transactions('August 2026')).toHaveCount(15);
  await expect.poll(() => reads.length).toBe(4);

  await page.getByRole('button', {name: 'Next month'}).click();
  await expect(transactions('September 2026')).toHaveCount(15);
  expect(reads.length).toBe(4);
});

test('Home does not retry a rate-limited request before the next refresh', async ({page}) => {
  await mockSyntheticHome(page, {clock: 'installed'});
  let reads = 0;
  await page.route('**/bank-transactions/spending-pace?**', (route) => {
    reads++;
    return route.fulfill({
      status: 429,
      headers: {'Retry-After': '60'},
      contentType: 'application/json',
      body: JSON.stringify({statusCode: 429, message: 'ThrottlerException: Too Many Requests'}),
    });
  });
  await page.goto('/');
  await expect(page.getByText("Couldn't load this month's spending")).toBeVisible();

  // Past every retry delay (1, 2 and 4 seconds) but well before the next 30-second refresh.
  await page.clock.runFor(10_000);
  expect(reads).toBe(1);
});

test('Home does not refresh while the tab is hidden', async ({page, homePage}) => {
  const state = await mockDerivedData(page);
  await page.goto('/');
  await expect(homePage.paceFigure).toHaveText('€1,200');
  await expect.poll(() => state.reads).toEqual({pace: 1, categories: 1, review: 1});
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => 'hidden'});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(95_000);
  expect(state.reads).toEqual({pace: 1, categories: 1, review: 1});
});
