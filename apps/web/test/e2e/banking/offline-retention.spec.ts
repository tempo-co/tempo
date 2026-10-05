import type {Page} from '@playwright/test';

import {VERIFIED_USER_AUTH_FILE} from '../../constants/auth.constants';
import {API_URL, expect, test} from '../../fixtures';
import {HomePage} from '../../pages/home.page';

const CACHE_KEY = 'tempo-offline-cache';
/** Pads each transactions page so that a few of them exceed the 2 MiB offline budget. */
const PAGE_PADDING = 700_000;
type SavedCache = {timestamp: number; clientState: {queries: {queryKey: unknown[]}[]}};

const savedSearches = (page: Page) =>
  page.evaluate((key) => {
    const cache = JSON.parse(localStorage.getItem(key) ?? 'null') as SavedCache | null;
    return cache?.clientState.queries
      .filter((query) => query.queryKey[0] === 'bank-transactions')
      .map((query) => (query.queryKey[2] as {search?: string}).search ?? '')
      .sort();
  }, CACHE_KEY);
const hasSavedAccount = (page: Page) =>
  page.evaluate(
    (key) =>
      (
        JSON.parse(localStorage.getItem(key) ?? 'null') as SavedCache | null
      )?.clientState.queries.some((query) => query.queryKey[0] === 'currentAccount') ?? false,
    CACHE_KEY,
  );
const savedAt = (page: Page) =>
  page.evaluate(
    (key) => (JSON.parse(localStorage.getItem(key) ?? 'null') as SavedCache | null)?.timestamp,
    CACHE_KEY,
  );
const isTransactionsRequest = (url: URL) => url.href.startsWith(`${API_URL}/bank-transactions?`);
const saveFailedToast = (page: Page) => page.getByText('Tempo cannot save data for offline use');

async function padTransactionPages(page: Page) {
  await page.route(isTransactionsRequest, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as object;
    await route.fulfill({response, json: {...body, padding: 'x'.repeat(PAGE_PADDING)}});
  });
}

async function search(page: Page, text: string, row: string) {
  await page.getByRole('textbox', {name: 'Search transactions'}).fill(text);
  await expect(page).toHaveURL(new RegExp(`search=${text}`));
  await expect(page.getByText(row, {exact: true}).first()).toBeVisible();
}

test.describe('offline retention', () => {
  test.use({storageState: VERIFIED_USER_AUTH_FILE});

  test('keeps the views on screen and the newest others within the budget', async ({
    page,
    context,
  }) => {
    test.setTimeout(40000);
    await padTransactionPages(page);
    await page.goto('/bank-transactions');
    await expect(page.getByText('Coffee shop')).toBeVisible();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await search(page, 'Coffee', 'Coffee shop');
    await search(page, 'Salary', 'Salary');
    await search(page, 'Provider', 'Provider purchase');
    await search(page, 'Extra', 'Extra transaction 1');

    // Two inactive 700 kB pages fit the budget; the older ones are no longer saved.
    await expect.poll(() => savedSearches(page)).toEqual(['Extra', 'Provider', 'Salary']);
    expect(await hasSavedAccount(page)).toBe(true);

    // Saved views reopen offline, also after a reload that starts on one of them; a dropped one
    // does not.
    await context.setOffline(true);
    for (const [text, row] of [
      ['Salary', 'Salary'],
      ['Salary', 'Salary'],
      ['Extra', 'Extra transaction 1'],
    ]) {
      const previousSave = await savedAt(page);
      await page.goto(`/bank-transactions?search=${text}`);
      await expect(page.getByText(row, {exact: true}).first()).toBeVisible();
      // The reopened app saves before the next reload.
      await expect.poll(() => savedAt(page)).not.toBe(previousSave);
    }
    expect(await savedSearches(page)).toEqual(['Extra', 'Provider', 'Salary']);
    await page.goto('/bank-transactions?search=Coffee');
    await expect(page.getByText('Transaction data is unavailable right now')).toBeVisible();
    await expect(page.getByText('Coffee shop', {exact: true})).not.toBeVisible();

    await context.setOffline(false);
    await expect(page.getByText('Coffee shop', {exact: true})).toBeVisible({timeout: 15000});
    await expect(page.getByRole('status').filter({hasText: /^Offline/})).not.toBeVisible({
      timeout: 15000,
    });

    await expect.poll(() => savedSearches(page)).toEqual(['Coffee', 'Extra', 'Provider']);
    // A page without transaction views saves within the same budget, not every view still loaded.
    await page.getByRole('link', {name: 'Connections'}).click();
    await expect(page.locator('[data-testid^="connection-card-toggle-"]').first()).toBeVisible();
    await expect.poll(() => savedSearches(page)).toEqual(['Coffee', 'Extra']);
  });

  test('a full browser storage drops older views but keeps the account signed in', async ({
    page,
    context,
  }) => {
    test.setTimeout(30000);
    // Storage that only fits two transaction pages.
    await page.addInitScript((key) => {
      const setItem = Object.getOwnPropertyDescriptor(Storage.prototype, 'setItem')!.value as (
        this: Storage,
        name: string,
        value: string,
      ) => void;
      Storage.prototype.setItem = function (name: string, value: string) {
        if (name === key && (value.length > 1_600_000 || 'tempoStorageFull' in window))
          throw new DOMException('Full', 'QuotaExceededError');
        setItem.call(this, name, value);
      };
    }, CACHE_KEY);
    await padTransactionPages(page);
    await page.goto('/bank-transactions');
    await expect(page.getByText('Coffee shop')).toBeVisible();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await search(page, 'Coffee', 'Coffee shop');
    await search(page, 'Salary', 'Salary');
    await expect.poll(() => savedSearches(page)).toEqual(['Coffee', 'Salary']);
    expect(await hasSavedAccount(page)).toBe(true);
    await expect(saveFailedToast(page)).not.toBeVisible();

    // Once nothing fits, the previous save stays and the user is told.
    await page.evaluate(() => Object.assign(window, {tempoStorageFull: true}));
    await search(page, 'Provider', 'Provider purchase');
    await expect(saveFailedToast(page)).toBeVisible();
    expect(await savedSearches(page)).toEqual(['Coffee', 'Salary']);
    await expect(new HomePage(page).sidebarAccountName).toBeVisible();
    await expect(page).toHaveURL(/\/bank-transactions/);

    await page.evaluate(() => Reflect.deleteProperty(window, 'tempoStorageFull'));
    await search(page, 'Extra', 'Extra transaction 1');
    await expect(saveFailedToast(page)).not.toBeVisible();
    await expect.poll(() => savedSearches(page)).toEqual(['Extra', 'Provider']);

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByText('Extra transaction 1', {exact: true}).first()).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByRole('status').filter({hasText: /^Offline/})).not.toBeVisible({
      timeout: 15000,
    });

    // The warning does not outlive the session: a logout in another tab removes it too.
    await page.evaluate(() => Object.assign(window, {tempoStorageFull: true}));
    await search(page, 'Coffee', 'Coffee shop');
    await expect(saveFailedToast(page)).toBeVisible();
    const other = await context.newPage();
    await other.goto('/login');
    await other.evaluate((key) => localStorage.removeItem(key), CACHE_KEY);
    await expect(page).toHaveURL(/\/login$/);
    await expect(saveFailedToast(page)).not.toBeVisible();
  });
});
