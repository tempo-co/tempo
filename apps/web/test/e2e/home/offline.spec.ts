import type {Page} from '@playwright/test';

import {dashboardQueryKeys} from '../../../src/features/banking/api/aggregate-query-keys';
import type {BankConnection} from '../../../src/features/banking/types/bank-connection';
import {VERIFIED_USER_AUTH_FILE} from '../../constants/auth.constants';
import {SEEDED_TRANSACTION_YEAR_NOW} from '../../constants/seed.constants';
import {septemberSummary} from '../../data/home-summary.data';
import {API_URL, expect, test} from '../../fixtures';
import {fulfillJson, mockBankConnections} from '../../utils/api-mocks';

const CACHE_KEY = 'tempo-offline-cache';
type SavedCache = {
  timestamp: number;
  clientState: {queries: {queryKey: unknown[]; state: {dataUpdatedAt: number}}[]};
};
const readCache = (page: Page) =>
  page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? 'null') as SavedCache | null,
    CACHE_KEY,
  );
const offlineStatus = (page: Page) => page.getByRole('status').filter({hasText: /^Offline/});
const spending = (page: Page, amount = '€1,200.00') =>
  page.getByTestId('spending-summary').getByRole('link', {name: amount, exact: true});
const attention = (page: Page) => page.getByRole('region', {name: 'Needs attention', exact: true});
const connection: BankConnection = {
  id: '00000000-0000-4000-8000-000000000001',
  provider: 'ENABLE_BANKING',
  aspspName: 'Example Bank',
  aspspCountry: 'NL',
  status: 'AUTHORIZED',
  consentValidUntil: '2027-01-01T00:00:00Z',
  lastSyncedAt: '2026-09-30T00:00:00Z',
  lastSyncError: null,
  nextSyncAt: null,
  syncStatus: 'SUCCEEDED',
  baseCurrency: 'EUR',
  bankAccounts: [],
};

async function mockHome(page: Page, padding = 0) {
  const state = {refreshed: false};
  await page.clock.install({time: SEEDED_TRANSACTION_YEAR_NOW});
  await mockBankConnections(page, () => [connection]);
  await page.route('**/bank-transactions/summary**', (route) => {
    const params = new URL(route.request().url()).searchParams;
    return fulfillJson(route, {
      ...septemberSummary,
      month: params.get('month'),
      through: params.get('asOf'),
      totals: {...septemberSummary.totals, spending: state.refreshed ? '1400.00' : '1200.00'},
      padding: 'x'.repeat(padding),
    });
  });
  await page.route('**/bank-transactions/review-counts', (route) =>
    fulfillJson(route, {
      needsReview: state.refreshed ? 5 : 3,
      categorizationFailed: 0,
      categorizing: 0,
      unknownDirection: 0,
      missingBaseAmount: 0,
    }),
  );
  await page.route(`${API_URL}/bank-transactions?**`, (route) =>
    fulfillJson(route, {transactions: [], total: 0}),
  );
  return state;
}

async function openSavedHome(page: Page) {
  await page.goto('/?month=2026-09');
  await expect(spending(page)).toBeVisible();
  await expect(attention(page)).toContainText('3 transactions');
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.clock.runFor(1100);
  await expect.poll(() => readCache(page)).not.toBe(null);
}

test.describe('saved Home', () => {
  test.use({storageState: VERIFIED_USER_AUTH_FILE});

  test('reopens summaries and review counts offline and refreshes them on reconnect', async ({
    page,
    context,
  }) => {
    test.setTimeout(30000);
    const state = await mockHome(page);
    await openSavedHome(page);
    await context.setOffline(true);
    await page.reload();
    await expect(offlineStatus(page)).toBeVisible();
    await expect(spending(page)).toBeVisible();
    await expect(attention(page)).toContainText('3 transactions');

    // A month that was never opened must not display another month's totals.
    await page.getByRole('link', {name: 'Previous month'}).click();
    await expect(page).toHaveURL(/month=2026-08/);
    await expect(page.getByLabel('Loading spending')).toBeVisible();
    await expect(page.getByTestId('spending-summary')).toHaveCount(0);
    await expect(attention(page)).toContainText('3 transactions');
    await page.getByRole('link', {name: 'Next month'}).click();
    await expect(spending(page)).toBeVisible();

    state.refreshed = true;
    await context.setOffline(false);
    await page.clock.resume();
    await expect(offlineStatus(page)).not.toBeVisible({timeout: 15000});
    await expect(spending(page, '€1,400.00')).toBeVisible();
    await expect(attention(page)).toContainText('5 transactions');
  });

  test('shares the recent-data budget with transaction views on every page', async ({page}) => {
    test.setTimeout(30000);
    await mockHome(page, 700_000);
    await page.goto('/?month=2026-07');
    await expect(spending(page)).toBeVisible();
    for (const month of ['2026-08', '2026-09']) {
      await page.getByRole('link', {name: 'Next month'}).click();
      await expect(page).toHaveURL(new RegExp(`month=${month}`));
      await expect(spending(page)).toBeVisible();
      await page.clock.runFor(1100);
    }
    const savedMonths = async () =>
      (await readCache(page))?.clientState.queries
        .filter(
          (query) =>
            query.queryKey[0] === dashboardQueryKeys.root[0] && query.queryKey[1] === 'summary',
        )
        .map((query) => query.queryKey[2])
        .sort();
    // On-screen September is exempt; both earlier months fit the existing shared budget.
    await expect.poll(savedMonths).toEqual(['2026-07', '2026-08', '2026-09']);
    await page.route(`${API_URL}/bank-transactions?**`, (route) =>
      fulfillJson(route, {transactions: [], total: 0, padding: 'x'.repeat(700_000)}),
    );
    await page.getByRole('link', {name: 'Transactions', exact: true}).click();
    await expect(page.getByRole('heading', {name: 'No bank transactions found'})).toBeVisible();
    await page.clock.runFor(1100);
    await expect.poll(savedMonths).toEqual(['2026-08', '2026-09']);
    await page.getByRole('link', {name: 'Connections', exact: true}).click();
    await expect(page.locator('[data-testid^="connection-card-toggle-"]').first()).toBeVisible();
    await page.clock.runFor(1100);
    // The inactive transactions now compete with summaries, rather than getting another budget.
    await expect.poll(savedMonths).toEqual(['2026-09']);
    const queries = (await readCache(page))!.clientState.queries;
    expect(queries.some((query) => query.queryKey[0] === 'currentAccount')).toBe(true);
    expect(queries.some((query) => query.queryKey[0] === 'bank-transactions')).toBe(true);
  });
});

test('logout removes saved Home data and prevents an offline reload from reopening it', async ({
  page,
  context,
  freshAccount,
  homePage,
}) => {
  await mockHome(page);
  await openSavedHome(page);
  await expect(homePage.sidebarAccountName).toHaveText(freshAccount.name);
  await expect
    .poll(async () =>
      (await readCache(page))?.clientState.queries.some(
        (query) => query.queryKey[0] === dashboardQueryKeys.root[0],
      ),
    )
    .toBe(true);
  await homePage.logOut();
  await expect(page).toHaveURL(/\/login$/);
  await page.clock.runFor(1100);
  expect(await readCache(page)).toBe(null);
  await context.setOffline(true);
  await page.goto('/?month=2026-09');
  await expect(page.getByRole('heading', {name: 'Cannot reach Tempo'})).toBeVisible();
  await expect(page.getByTestId('spending-summary')).toHaveCount(0);
  await expect(attention(page)).toHaveCount(0);
});
