import {type Locator, type Page, expect} from '@playwright/test';

import {REFRESH_RESULT} from '../data/bank-connection.data';
import {API_URL} from '../fixtures';
import {EMPTY_REVIEW_COUNTS, FILE_IMPORT_OFF, fulfillJson} from './api-mocks';

/** Opens a bank's details dialog from its card. */
export async function openDetails(page: Page, card: Locator) {
  await card.getByRole('button', {name: / details$/}).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Opens a bank's details and switches the dialog to its removal step. */
export async function openRemoval(page: Page, card: Locator) {
  const dialog = await openDetails(page, card);
  await dialog.getByRole('button', {name: 'Remove connection'}).click();
  await expect(dialog.getByTestId(/^remove-bank-confirm-/)).toBeVisible();
  return dialog;
}

/** Signs in a mocked account and answers the app-wide API reads; any other non-app request fails the test. */
export async function routeMockedBankApp(page: Page, baseURL: string | undefined) {
  // Every non-app request is intercepted; an incomplete mock must never reach a real bank/API.
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(baseURL!).origin) return route.continue();
    if (url.origin === API_URL && url.pathname === '/accounts/me') {
      return fulfillJson(route, {
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Example User',
        email: 'user@example.com',
        isEmailVerified: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      });
    }
    if (url.origin === API_URL && url.pathname === '/bank-connections/aspsps')
      return fulfillJson(route, []);
    if (url.origin === API_URL && url.pathname === '/health') return fulfillJson(route, {});
    // Connections asks whether file import is on: off unless a spec routes it.
    if (url.origin === API_URL && url.pathname === '/bank-imports')
      return fulfillJson(route, FILE_IMPORT_OFF, 404);
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
    await route.abort('blockedbyclient');
    throw new Error(`Unmocked request: ${route.request().method()} ${url}`);
  });
}
