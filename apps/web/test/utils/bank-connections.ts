import {type Locator, type Page, expect} from '@playwright/test';

import {createAccount} from '../data/account.data';
import {REFRESH_RESULT} from '../data/bank-connection.data';
import {API_URL} from '../fixtures';
import {
  EMPTY_REVIEW_COUNTS,
  FILE_IMPORT_OFF,
  SETTLED_REPORTING_CURRENCY,
  fulfillJson,
} from './api-mocks';

/** An account's row on Accounts. */
export const accountRow = (page: Page, accountId: string) =>
  page.getByTestId(`account-row-${accountId}`);

/** The freshness lines that need attention: a connection in trouble, a stale file or a long-quiet sync. */
export const attentionLines = (scope: Page | Locator) =>
  scope.locator('[data-testid="account-freshness"][data-tone="warning"]');

/** Opens an account's page from its row on Accounts, and returns its connection card. */
export async function openAccount(page: Page, accountId: string) {
  await accountRow(page, accountId).getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`/accounts/${accountId}$`));
  await expect(page.getByTestId('account-about')).toBeVisible();
  return page.getByTestId('account-connection');
}

/** Opens the removal of a synced account's connection from the account's page: the bank's Remove connection. */
export async function openRemoval(page: Page, accountId: string) {
  await openAccount(page, accountId);
  await page.getByRole('button', {name: 'Remove connection', exact: true}).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId(/^remove-bank-confirm-/)).toBeVisible();
  return dialog;
}

/** Chooses to delete the bank's accounts and history in its removal step. */
export async function chooseDeleteEverything(dialog: Locator) {
  await dialog.getByText('Delete everything', {exact: true}).click();
  await expect(dialog.getByRole('radio', {name: /^Delete everything/})).toBeChecked();
}

/** Signs in a mocked account and answers the app-wide API reads; any other non-app request fails the test. */
export async function routeMockedBankApp(page: Page, baseURL: string | undefined) {
  // Every non-app request is intercepted; an incomplete mock must never reach a real bank/API.
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(baseURL!).origin) return route.continue();
    if (url.origin === API_URL && url.pathname === '/accounts/me') {
      return fulfillJson(route, createAccount({name: 'Example User'}));
    }
    if (url.origin === API_URL && url.pathname === '/bank-connections/aspsps')
      return fulfillJson(route, []);
    if (url.origin === API_URL && url.pathname === '/health') return fulfillJson(route, {});
    // Connections asks whether file import is on: off unless a spec routes it.
    if (url.origin === API_URL && url.pathname === '/bank-imports')
      return fulfillJson(route, FILE_IMPORT_OFF, 404);
    // Connections asks whether the owner still has to choose a currency for totals.
    if (url.origin === API_URL && url.pathname === '/reporting-currency')
      return fulfillJson(route, SETTLED_REPORTING_CURRENCY);
    // The navigation's review badge reads these on every page.
    if (url.origin === API_URL && url.pathname === '/bank-transactions/review-counts')
      return fulfillJson(route, EMPTY_REVIEW_COUNTS);
    if (url.origin === API_URL && url.pathname.endsWith('/refresh'))
      return fulfillJson(route, REFRESH_RESULT);
    // Settings reads whether this server sends notifications.
    if (url.origin === API_URL && url.pathname === '/notifications')
      return fulfillJson(route, {
        publicKey: null,
        preferences: {bankConnections: true},
      });
    // Log out sits in Settings › Security, beside the session list.
    if (url.origin === API_URL && url.pathname === '/auth/sessions') return fulfillJson(route, []);
    await route.abort('blockedbyclient');
    throw new Error(`Unmocked request: ${route.request().method()} ${url}`);
  });
}
