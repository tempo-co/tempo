import type {Page} from '@playwright/test';
import type {BankConnection} from '@wisp/contracts';

import {MOCK_CONNECTION} from '../../data/bank-connection.data';
import {API_URL, expect, test} from '../../fixtures';
import {mockAccountsApi} from '../../utils/accounts';
import {fulfillJson, fulfillRedirect, mockJson} from '../../utils/api-mocks';
import {accountRow, routeMockedBankApp} from '../../utils/bank-connections';

const BANK = {name: 'Example Bank', country: 'NL', logoUrl: null};
const AUTHORIZATION_URL = 'https://bank.example.test/authorize';

/**
 * A signed-in owner with file import on and no accounts until the bank connects. Every hand-off to the bank comes
 * back to Accounts with `result`; the returned list records each authorization request.
 */
async function mockConnect(page: Page, baseURL: string | undefined, result: () => string) {
  await routeMockedBankApp(page, baseURL);
  let connections: BankConnection[] = [];
  await mockAccountsApi(page, () => ({connections, imports: []}));
  await mockJson(page, '**/bank-connections/aspsps', [BANK]);
  const authorizations: unknown[] = [];
  await page.route(`${API_URL}/bank-connections/authorize`, (route) => {
    authorizations.push(route.request().postDataJSON());
    return fulfillJson(route, {authorizationUrl: AUTHORIZATION_URL}, 201);
  });
  await page.route(AUTHORIZATION_URL, (route) => {
    const answer = result();
    if (answer === 'connected')
      connections = [
        {
          ...MOCK_CONNECTION,
          aspspName: BANK.name,
          lastSyncedAt: new Date().toISOString(),
          lastSuccessfulSyncAt: new Date().toISOString(),
        },
      ];
    return fulfillRedirect(route, new URL(`/accounts?result=${answer}`, baseURL).toString());
  });
  return authorizations;
}

/** Add data in the sidebar, Connect a bank, the bank, then Continue: the hand-off to the bank's site. */
async function connectFromAddData(page: Page) {
  await page.getByTestId('app-sidebar').getByRole('button', {name: 'Add data'}).click();
  const sheet = page.getByTestId('add-data-sheet');
  await expect(sheet.getByRole('heading', {name: 'Add data'})).toBeVisible();
  await sheet.getByRole('button', {name: /^Connect a bank/}).click();
  await expect(sheet.getByRole('heading', {name: 'Connect a bank'})).toBeVisible();
  await sheet.getByRole('button', {name: 'Example Bank', exact: true}).click();
  await expect(sheet.getByRole('heading', {name: 'Connect Example Bank'})).toBeVisible();
  await sheet.getByRole('button', {name: 'Continue to Example Bank'}).click();
  return sheet;
}

test.describe('Connect a bank from Add data', () => {
  test.use({storageState: {cookies: [], origins: []}, serviceWorkers: 'block'});

  test('hands off to the bank from any page, and its accounts show on Accounts synced just now', async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize({width: 1440, height: 900});
    const authorizations = await mockConnect(page, baseURL, () => 'connected');
    await page.goto('/settings/profile');

    await connectFromAddData(page);
    await expect(page).toHaveURL(/\/accounts$/);
    expect(authorizations).toEqual([{aspspName: 'Example Bank', aspspCountry: 'NL'}]);
    await expect(page.getByText('Bank connection added')).toBeVisible();
    await expect(page.getByTestId('add-data-sheet')).toHaveCount(0);
    const row = accountRow(page, MOCK_CONNECTION.bankAccounts[0].id);
    await expect(row).toContainText('Example Bank');
    await expect(row.getByTestId('account-freshness')).toHaveText('Synced just now');
  });

  test('back from the bank unfinished, the sheet says nothing was connected and tries the same bank again', async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize({width: 1440, height: 900});
    const answers = ['cancelled', 'error', 'connected'];
    const authorizations = await mockConnect(page, baseURL, () => answers.shift()!);
    await page.goto('/settings/profile');

    await connectFromAddData(page);
    await expect(page).toHaveURL(/\/accounts$/);
    const sheet = page.getByTestId('add-data-sheet');
    await expect(
      sheet.getByRole('heading', {name: "You didn't finish at Example Bank"}),
    ).toBeVisible();
    await expect(sheet.getByRole('alert')).toHaveText(
      "Nothing was connectedYou left Example Bank's site before approving access.",
    );
    await expect(page.getByTestId(/^account-row-/)).toHaveCount(0);

    await sheet.getByRole('button', {name: 'Try again'}).click();
    await expect(sheet.getByRole('heading', {name: "Example Bank didn't connect"})).toBeVisible();
    await expect(sheet.getByRole('alert')).toContainText("Couldn't finish the connection");
    // A failed connection offers the file instead, or another bank.
    await expect(sheet.getByRole('button', {name: 'Import a file instead'})).toBeVisible();
    await sheet.getByRole('button', {name: 'Pick another bank'}).click();
    await expect(sheet.getByRole('heading', {name: 'Connect a bank'})).toBeVisible();
    await sheet.getByRole('button', {name: 'Example Bank', exact: true}).click();
    await sheet.getByRole('button', {name: 'Continue to Example Bank'}).click();

    await expect(page.getByText('Bank connection added')).toBeVisible();
    expect(authorizations).toHaveLength(3);
  });
});
