import type {Page} from '@playwright/test';
import type {BankConnection} from '@tempo/contracts';

import {VERIFIED_USER_AUTH_FILE} from '../../constants/auth.constants';
import {
  HOME_NOW,
  HOME_REVIEW_COUNTS,
  mockHomeHistory,
  monthTransactions,
} from '../../data/home-history.data';
import {API_URL, expect, test} from '../../fixtures';
import {fulfillJson, mockBankConnections, mockJson} from '../../utils/api-mocks';

const CACHE_KEY = 'tempo-offline-cache';
type SavedCache = {
  timestamp: number;
  clientState: {queries: {queryKey: unknown[]; state: {dataUpdatedAt: number; data: unknown}}[]};
};
const readCache = (page: Page) =>
  page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? 'null') as SavedCache | null,
    CACHE_KEY,
  );

const offlineStatus = (page: Page) => page.getByRole('status').filter({hasText: /^Offline/});
const totalBalance = (page: Page) =>
  page
    .getByRole('region', {name: 'Where you stand'})
    .getByRole('heading', {name: 'Total balance'})
    .locator('xpath=following-sibling::p[1]');
const reviewBadge = (page: Page, count: number) =>
  page.getByRole('link', {name: `Transactions, ${count} to review`}).first();
const monthRows = (page: Page, title: string) =>
  page
    .getByRole('dialog', {name: title})
    .getByRole('region', {name: 'Transactions'})
    .getByRole('listitem');
const connection: BankConnection = {
  id: '00000000-0000-4000-8000-000000000001',
  provider: 'ENABLE_BANKING',
  aspspName: 'Example Bank',
  aspspCountry: 'NL',
  logo: {metadataUrl: '/bank-connections/aspsps/logos/NL/Example%20Bank'},
  status: 'AUTHORIZED',
  consentValidUntil: '2027-01-01T00:00:00Z',
  lastSyncedAt: '2026-09-30T00:00:00Z',
  lastSuccessfulSyncAt: '2026-09-30T00:00:00Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastSyncError: null,
  nextSyncAt: null,
  syncStatus: 'SUCCEEDED',
  baseCurrency: 'EUR',
  bankAccounts: [],
};
const LOGO_URL = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#2563eb"/></svg>',
)}`;

async function mockHome(page: Page, padding = 0) {
  const state = {refreshed: false};
  await page.clock.install({time: HOME_NOW});
  await mockBankConnections(page, () => [connection]);
  await mockJson(page, '**/bank-connections/aspsps', [
    {name: 'Example Bank', country: 'NL', logoUrl: LOGO_URL},
    {name: 'Other Bank', country: 'FI', logoUrl: LOGO_URL},
  ]);
  await mockJson(page, '**/bank-connections/aspsps/logos/NL/Example%20Bank', {
    url: LOGO_URL,
  });
  await mockHomeHistory(page);
  await page.route('**/bank-transactions/review-counts', (route) =>
    fulfillJson(route, {
      ...HOME_REVIEW_COUNTS,
      needsReview: state.refreshed ? 3 : 2,
      needsAttention: state.refreshed ? 4 : 3,
    }),
  );
  await page.route(`${API_URL}/bank-transactions?**`, (route) => {
    const from = new URL(route.request().url()).searchParams.get('filter[bookingDate][from]');
    return fulfillJson(route, {
      ...(from ? monthTransactions(from.slice(0, 7), 3) : {transactions: [], total: 0}),
      padding: 'x'.repeat(padding),
    });
  });
  return state;
}

/** Opens September's transactions, then Home with its review badge, and waits for both to be saved. */
async function openSavedHome(page: Page) {
  await page.goto('/?month=2026-09');
  await expect(monthRows(page, 'September 2026')).toHaveCount(3);
  await page.keyboard.press('Escape');
  await expect(reviewBadge(page, 3)).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.clock.runFor(1100);
  await expect.poll(() => readCache(page)).not.toBe(null);
}

test.describe('saved Home', () => {
  test.use({storageState: VERIFIED_USER_AUTH_FILE, timezoneId: 'Europe/Amsterdam'});

  test('reopens Home, its months and review counts offline and refreshes them on reconnect', async ({
    page,
    context,
  }) => {
    test.setTimeout(30000);
    const state = await mockHome(page);
    await openSavedHome(page);
    // Connections shows the bank's logo; only the connected banks' logos are saved, not the provider's
    // whole bank list.
    await page
      .getByRole('navigation', {name: 'Primary'})
      .getByRole('link', {name: 'Connections', exact: true})
      .click();
    await expect(page.getByTestId('bank-connection-logo').locator('img:visible')).toHaveAttribute(
      'src',
      LOGO_URL,
    );
    await page.goBack();
    await expect(totalBalance(page)).toHaveText('€24,300');
    const savedQueries = async () => {
      await page.clock.runFor(1100);
      return (await readCache(page))?.clientState.queries ?? [];
    };
    await expect
      .poll(
        async () =>
          (await savedQueries()).find((query) => query.queryKey[0] === 'connected-bank-logos')
            ?.state.data,
      )
      .toEqual({'NL:example bank': {logo: connection.logo}});
    await expect
      .poll(async () => (await savedQueries()).some((query) => query.queryKey[0] === 'bank-logo'))
      .toBe(true);
    expect(JSON.stringify(await savedQueries())).not.toContain('Other Bank');
    await context.setOffline(true);
    await page.reload();
    await expect(offlineStatus(page)).toBeVisible();
    await expect(totalBalance(page)).toHaveText('€24,300');
    await expect(reviewBadge(page, 3)).toBeVisible();

    // A saved month reopens; one whose transactions were never loaded must not show another month's.
    await page
      .getByRole('region', {name: 'Year by year'})
      .getByRole('link', {name: 'September'})
      .click();
    await expect(monthRows(page, 'September 2026')).toHaveCount(3);
    await page.getByRole('button', {name: 'Previous month'}).click();
    await expect(page).toHaveURL(/month=2026-08/);
    await expect(page.getByRole('dialog', {name: 'August 2026'})).toContainText('In€3,000');
    await expect(monthRows(page, 'August 2026')).toHaveCount(0);
    await page.getByRole('button', {name: 'Next month'}).click();
    await expect(monthRows(page, 'September 2026')).toHaveCount(3);
    await page.keyboard.press('Escape');
    await expect(totalBalance(page)).toHaveText('€24,300');

    // The connected bank's logo is saved, so it shows offline too.
    await page
      .getByRole('navigation', {name: 'Primary'})
      .getByRole('link', {name: 'Connections', exact: true})
      .click();
    await expect(page.getByTestId('bank-connection-logo').locator('img:visible')).toHaveAttribute(
      'src',
      LOGO_URL,
    );
    await page.goBack();
    await expect(totalBalance(page)).toHaveText('€24,300');

    state.refreshed = true;
    await context.setOffline(false);
    await page.clock.resume();
    await expect(offlineStatus(page)).not.toBeVisible({timeout: 15000});
    await expect(reviewBadge(page, 4)).toBeVisible();
  });

  test('shares the recent-data budget with transaction views on every page', async ({page}) => {
    test.setTimeout(30000);
    await mockHome(page, 700_000);
    await page.goto('/?month=2026-07');
    await expect(monthRows(page, 'July 2026')).toHaveCount(3);
    for (const [month, title] of [
      ['2026-08', 'August 2026'],
      ['2026-09', 'September 2026'],
    ]) {
      await page.getByRole('button', {name: 'Next month'}).click();
      await expect(page).toHaveURL(new RegExp(`month=${month}`));
      await expect(monthRows(page, title)).toHaveCount(3);
      await page.clock.runFor(1100);
    }
    // Each month's transactions are saved under its first day.
    const savedMonths = async () =>
      (await readCache(page))?.clientState.queries
        .filter((query) => query.queryKey[1] === 'month-transactions')
        .map((query) => String(query.queryKey[2]).slice(0, 7))
        .sort();
    // On-screen September is exempt; both earlier months fit the shared budget.
    await expect.poll(savedMonths).toEqual(['2026-07', '2026-08', '2026-09']);
    await page.keyboard.press('Escape');
    await page
      .getByRole('link', {name: /^Transactions/})
      .first()
      .click();
    await expect(page.getByRole('heading', {name: 'No bank transactions found'})).toBeVisible();
    await page.clock.runFor(1100);
    await expect.poll(savedMonths).toEqual(['2026-08', '2026-09']);
    await page.getByRole('link', {name: 'Connections', exact: true}).first().click();
    await expect(
      page.getByTestId('bank-connections-list').getByRole('region').first(),
    ).toBeVisible();
    await page.clock.runFor(1100);
    // Inactive transactions share one budget rather than each view getting its own.
    await expect.poll(savedMonths).toEqual(['2026-09']);
    const queries = (await readCache(page))!.clientState.queries;
    expect(queries.some((query) => query.queryKey[0] === 'currentAccount')).toBe(true);
    // Home's own figures are saved too, beside the month's transactions.
    expect(
      queries.some(
        (query) =>
          query.queryKey[0] === 'bank-dashboard' && query.queryKey[1] !== 'month-transactions',
      ),
    ).toBe(true);
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
  await expect(homePage.accountName).toHaveText(freshAccount.name);
  await expect
    .poll(async () =>
      (await readCache(page))?.clientState.queries.some(
        (query) => query.queryKey[0] === 'bank-dashboard',
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
  await expect(page.getByRole('region', {name: 'Where you stand'})).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
