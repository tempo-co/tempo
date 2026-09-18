import {expect, test} from '@playwright/test';

import type {BankConnection} from '../../../src/features/banking/types/bank-connection';
import {PW_CHANGE_USER_AUTH_FILE, VERIFIED_USER_AUTH_FILE} from '../../constants/auth.constants';

const DETAIL_TRANSACTION_ID = '00000000-0000-4000-8000-000000000014';
const MOCK_PROVIDER_ORIGIN = 'https://enablebanking.test';
const TARGET_ASPSP = {name: 'Mock ASPSP', country: 'NL'};
const MOCK_CONNECTION: BankConnection = {
  id: '00000000-0000-4000-8000-000000000096',
  provider: 'enable-banking',
  aspspName: TARGET_ASPSP.name,
  aspspCountry: TARGET_ASPSP.country,
  status: 'AUTHORIZED',
  consentValidUntil: '2030-01-01T00:00:00.000Z',
  lastSyncedAt: null,
  bankAccounts: [
    {
      id: '00000000-0000-4000-8000-000000000097',
      name: 'Mock current account',
      details: 'Mock ASPSP checking account',
      alias: null,
      currency: 'EUR',
      cashAccountType: 'CACC',
      usage: 'PRIV',
      maskedIdentifier: '****1234',
      currentBalanceAmount: '1234.56',
      currentBalanceType: 'AVAILABLE',
      balanceUpdatedAt: null,
      isActive: true,
      latestBalances: [],
    },
  ],
};

test.describe('bank connections', () => {
  test.use({storageState: VERIFIED_USER_AUTH_FILE});

  test('shows seeded connection data, callback feedback, and provider logo', async ({page}) => {
    await page.route('**/bank-connections/aspsps', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            name: 'ABN AMRO',
            country: 'NL',
            logoUrl: 'https://enablebanking.com/brands/NL/ABN-AMRO/',
          },
        ]),
      });
    });

    await page.route('**/bank-connections', async (route) => {
      if (route.request().resourceType() === 'document') {
        await route.continue();
        return;
      }

      const response = await route.fetch();
      const connections = (await response.json()) as BankConnection[];
      const seededConnection = connections.find(
        (connection) => connection.aspspName === 'ABN AMRO',
      );
      if (!seededConnection) throw new Error('Expected a seeded ABN AMRO connection');

      await route.fulfill({response, json: [seededConnection]});
    });

    await page.route('**/bank-connections/*/transactions**', async (route) => {
      const response = await route.fetch();
      const payload = (await response.json()) as {
        transactions: Array<Record<string, unknown>>;
        total: number;
      };
      const [recentTransaction, ...remainingTransactions] = payload.transactions;
      if (!recentTransaction) throw new Error('Expected a seeded recent bank transaction');

      await route.fulfill({
        response,
        json: {
          ...payload,
          transactions: [
            {
              ...recentTransaction,
              category: null,
              categoryStatus: 'NOT_APPLICABLE',
              categorySource: null,
              financialEventType: 'CURRENCY_EXCHANGE',
              financialEventSource: 'RULE',
              financialEventRuleVersion: 'revolut-currency-exchange-v1',
              cashFlowTreatment: 'INTERNAL',
            },
            ...remainingTransactions,
          ],
        },
      });
    });

    await page.goto('/bank-connections?result=connected');

    await expect(page.getByRole('heading', {name: 'Bank connections'})).toBeVisible();
    await expect(page.getByText('1 connection', {exact: true})).toBeVisible();
    const connectionCard = page
      .locator('[data-testid^="bank-connection-"]')
      .filter({has: page.getByRole('heading', {name: 'ABN AMRO'})});
    await expect(connectionCard).toBeVisible();
    await expect(connectionCard.getByRole('heading', {name: 'Accounts'})).toBeVisible();
    await expect(connectionCard.getByRole('heading', {name: 'Recent transactions'})).toBeVisible();
    await expect(connectionCard.getByText('Connected', {exact: true})).toBeVisible();
    await expect(connectionCard.getByTestId('bank-connection-freshness')).toContainText('Updated');

    const bankLogo = connectionCard.getByTestId('bank-connection-logo');
    await expect(bankLogo).toBeVisible();
    await expect(bankLogo.locator('img')).toHaveAttribute(
      'src',
      'https://enablebanking.com/brands/NL/ABN-AMRO/',
    );
    await expect(bankLogo).toHaveClass(/border-border/);
    await expect(bankLogo).toHaveClass(/bg-background/);
    await expect(bankLogo).toHaveCSS('width', '52px');
    await expect(bankLogo).toHaveCSS('height', '52px');

    const status = connectionCard.getByTestId('bank-connection-status');
    const freshness = connectionCard.getByTestId('bank-connection-freshness');
    const syncButton = connectionCard.getByRole('button', {name: 'Sync now'});
    const [statusBox, freshnessBox, syncButtonBox] = await Promise.all([
      status.boundingBox(),
      freshness.boundingBox(),
      syncButton.boundingBox(),
    ]);
    expect(statusBox).not.toBeNull();
    expect(freshnessBox).not.toBeNull();
    expect(syncButtonBox).not.toBeNull();
    const verticalCenters = [statusBox!, freshnessBox!, syncButtonBox!].map(
      (box) => box.y + box.height / 2,
    );
    expect(Math.max(...verticalCenters) - Math.min(...verticalCenters)).toBeLessThan(1);
    await expect(connectionCard.getByText('Daily spending', {exact: true})).toBeVisible();
    await expect(connectionCard.getByText('available · primary')).toBeVisible();
    await expect(connectionCard.getByText('Provider purchase')).toBeVisible();
    await expect(connectionCard).toContainText('Currency exchange');
    await expect(connectionCard).toContainText('Internal movement');
    const transactionTrigger = connectionCard.getByRole('button', {
      name: 'View transaction details for Provider purchase',
    });
    await expect(transactionTrigger).toBeVisible();
    await expect(transactionTrigger.locator('..').locator('p')).toHaveText('18 Aug');
    await transactionTrigger.click();
    const inspector = page.getByTestId('bank-transaction-inspector');
    await expect(inspector).toBeVisible();
    expect(new URL(page.url()).searchParams.get('transactionId')).toBe(DETAIL_TRANSACTION_ID);
    await expect(inspector.getByRole('heading', {name: 'Provider purchase'})).toBeVisible();
    await expect(inspector.getByText('Bank transaction', {exact: true})).toBeVisible();
    await inspector.getByRole('button', {name: 'Close transaction details'}).click();
    await expect(inspector).toBeHidden();
    await expect(transactionTrigger).toBeFocused();
    expect(new URL(page.url()).searchParams.has('transactionId')).toBe(false);
    await expect(page.getByText('Bank connection added')).toBeVisible();
    await expect(page).toHaveURL(new RegExp('/bank-connections$'));
  });

  test('reports when synchronization finds no new transactions', async ({page}) => {
    await page.route('**/bank-connections/*/sync', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: '00000000-0000-4000-8000-000000000099',
          status: 'SUCCEEDED',
          startedAt: '2026-09-09T00:00:00.000Z',
          finishedAt: '2026-09-09T00:00:01.000Z',
          requestedFrom: '2026-09-02',
          requestedTo: '2026-09-09',
          accountsFetched: 1,
          balancesFetched: 1,
          transactionsFetched: 17,
          transactionsAdded: 0,
          errorMessage: null,
          rateLimitSource: null,
          retryAfterSeconds: null,
        }),
      });
    });

    await page.goto('/bank-connections');
    await page.getByRole('button', {name: 'Sync now'}).click();

    await expect(page.getByText('Sync complete', {exact: true})).toBeVisible();
    await expect(page.getByText('No new transactions found.', {exact: true})).toBeVisible();
  });

  test('removes an incomplete bank connection', async ({page}) => {
    const pendingConnectionId = '00000000-0000-4000-8000-000000000098';
    let pendingConnectionVisible = true;
    const pendingConnection = {
      id: pendingConnectionId,
      provider: 'enable-banking',
      aspspName: 'ABN AMRO',
      aspspCountry: 'NL',
      status: 'PENDING_AUTHORIZATION',
      consentValidUntil: null,
      lastSyncedAt: null,
      bankAccounts: [],
    };

    await page.route('**/bank-connections', async (route) => {
      if (route.request().resourceType() === 'document') {
        await route.continue();
        return;
      }

      const response = await route.fetch();
      const connections = (await response.json()) as BankConnection[];
      await route.fulfill({
        response,
        json: pendingConnectionVisible ? [...connections, pendingConnection] : connections,
      });
    });
    await page.route(`**/bank-connections/${pendingConnectionId}`, async (route) => {
      if (route.request().method() !== 'DELETE') {
        await route.continue();
        return;
      }

      pendingConnectionVisible = false;
      await route.fulfill({status: 204, body: ''});
    });

    await page.goto('/bank-connections');

    const pendingCard = page.getByTestId(`bank-connection-${pendingConnectionId}`);
    await expect(pendingCard).toBeVisible();
    await expect(pendingCard.getByRole('button', {name: 'Remove'})).toBeVisible();
    await pendingCard.getByRole('button', {name: 'Remove'}).click();

    await expect(page.getByText('Bank connection removed', {exact: true})).toBeVisible();
    await expect(pendingCard).toHaveCount(0);
  });

  test('requires explicit confirmation before removing a connected bank connection', async ({
    page,
  }) => {
    const connectedConnectionId = '00000000-0000-4000-8000-000000000097';
    let connectedConnectionVisible = true;
    let deleteCalled = false;

    await page.route('**/bank-connections', async (route) => {
      if (route.request().resourceType() === 'document') {
        await route.continue();
        return;
      }

      const response = await route.fetch();
      const connections = (await response.json()) as BankConnection[];
      const connectedConnection = {
        ...connections[0],
        id: connectedConnectionId,
        status: 'AUTHORIZED',
        lastSyncedAt: null,
      };
      await route.fulfill({
        response,
        json: connectedConnectionVisible ? [connectedConnection] : [],
      });
    });
    await page.route(`**/bank-connections/${connectedConnectionId}`, async (route) => {
      if (route.request().method() !== 'DELETE') {
        await route.continue();
        return;
      }

      deleteCalled = true;
      connectedConnectionVisible = false;
      expect(route.request().postDataJSON()).toEqual({confirmation: 'DELETE'});
      await route.fulfill({status: 204, body: ''});
    });

    await page.goto('/bank-connections');

    const connectedCard = page.getByTestId(`bank-connection-${connectedConnectionId}`);
    await expect(connectedCard).toBeVisible();
    await connectedCard.getByRole('button', {name: 'Remove'}).click();
    await expect(page.getByRole('heading', {name: 'Remove connected bank?'})).toBeVisible();
    await expect(page.getByText(/all linked bank accounts, and all transactions/)).toBeVisible();
    expect(deleteCalled).toBe(false);

    const confirmButton = page.getByTestId(`remove-bank-confirm-${connectedConnectionId}`);
    await expect(confirmButton).toBeDisabled();
    await page.getByTestId(`remove-bank-confirmation-${connectedConnectionId}`).fill('DELETE');
    await expect(confirmButton).toBeEnabled();
    await confirmButton.click();

    await expect(page.getByText('Bank connection removed', {exact: true})).toBeVisible();
    expect(deleteCalled).toBe(true);
    await expect(connectedCard).toHaveCount(0);
  });

  test('keeps selectors visible while loading and lets the user choose a supported bank', async ({
    page,
  }) => {
    let releaseResponse!: () => void;
    const responseHeld = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    let authorizationRequest: {aspspName: string; aspspCountry: string} | undefined;

    await page.route('**/bank-connections/aspsps', async (route) => {
      await responseHeld;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            name: 'ABN AMRO',
            country: 'NL',
            logoUrl: 'https://enablebanking.com/brands/NL/ABN-AMRO/',
          },
          {name: 'Nordea', country: 'FI', logoUrl: 'https://enablebanking.com/brands/FI/Nordea/'},
          {name: 'Revolut', country: 'NL', logoUrl: 'https://enablebanking.com/brands/NL/Revolut/'},
        ]),
      });
    });
    await page.route('**/bank-connections/authorize', async (route) => {
      authorizationRequest = JSON.parse(route.request().postData() || '{}') as {
        aspspName: string;
        aspspCountry: string;
      };
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({authorizationUrl: 'https://auth.example.test/revolut'}),
      });
    });
    await page.route('https://auth.example.test/revolut', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<p>Enable Banking authorization</p>',
      });
    });

    await page.goto('/bank-connections');
    await page.getByRole('button', {name: 'Connect a bank'}).click();

    const picker = page.getByTestId('bank-connection-picker');
    const countrySelector = picker.getByTestId('bank-connection-country-selector');
    const bankSelector = picker.getByTestId('bank-connection-bank-selector');
    await expect(picker).toBeVisible();
    await expect(picker.getByText(/personal account-information access/)).toHaveCount(0);
    await expect(countrySelector).toBeVisible();
    await expect(countrySelector).toBeDisabled();
    await expect(bankSelector).toBeVisible();
    await expect(bankSelector).toBeDisabled();
    await expect(picker.getByRole('status')).toHaveCount(0);

    releaseResponse();
    await expect(countrySelector).toBeEnabled();
    await expect(bankSelector).toBeDisabled();
    await countrySelector.click();
    await page.getByPlaceholder('Search countries...').fill('NL');
    await expect(page.getByRole('option', {name: /Netherlands.*2 banks/})).toBeVisible();
    await page.getByPlaceholder('Search countries...').fill('');
    await expect(page.getByRole('option', {name: /Netherlands.*2 banks/})).toBeVisible();
    await page.getByRole('option', {name: /Netherlands.*2 banks/}).click();

    await expect(bankSelector).toBeEnabled();
    await bankSelector.click();
    const revolutOption = page.getByRole('option', {name: /Revolut.*NL/});
    await expect(revolutOption).toBeVisible();
    const bankLogo = revolutOption.getByTestId('bank-logo');
    await expect(bankLogo).toBeVisible();
    await expect(bankLogo).toHaveClass(/border-border/);
    await expect(bankLogo).toHaveClass(/bg-background/);
    await expect(bankLogo).toHaveCSS('width', '48px');
    await expect(bankLogo).toHaveCSS('height', '48px');
    await expect(page.getByRole('option', {name: /Nordea.*FI/})).toHaveCount(0);
    await revolutOption.click();

    await expect
      .poll(() => authorizationRequest)
      .toEqual({aspspName: 'Revolut', aspspCountry: 'NL'});
    await expect(page).toHaveURL('https://auth.example.test/revolut');
  });

  test('reopens a connection transaction inspector from its shareable URL', async ({page}) => {
    await page.goto('/bank-connections');

    const transactionTrigger = page.getByRole('button', {
      name: 'View transaction details for Provider purchase',
    });
    await transactionTrigger.click();

    const sharedUrl = page.url();
    expect(new URL(sharedUrl).searchParams.get('transactionId')).toBe(DETAIL_TRANSACTION_ID);

    await page.goto(sharedUrl);
    const inspector = page.getByTestId('bank-transaction-inspector');
    await expect(inspector).toBeVisible();
    await expect(inspector.getByRole('heading', {name: 'Provider purchase'})).toBeVisible();
    expect(new URL(page.url()).searchParams.get('transactionId')).toBe(DETAIL_TRANSACTION_ID);
  });

  test('returns to the installed app after bank authorization', async ({page, context}) => {
    await page.goto('/bank-connections');
    const authorizationUrl = 'https://bank.example.test/mock-bank-authorization';
    const callbackUrl = new URL('./bank-connections?result=connected', page.url()).toString();
    await page.route('**/bank-connections/aspsps', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            name: 'Mock ASPSP',
            country: 'NL',
            logoUrl: 'https://enablebanking.com/brands/NL/Mock-ASPSP/',
          },
        ]),
      });
    });
    await page.route('**/bank-connections/authorize', async (route) => {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({authorizationUrl}),
      });
    });
    await context.route('**/mock-bank-authorization', async (route) => {
      await route.fulfill({status: 302, headers: {location: callbackUrl}});
    });

    let popupOpened = false;
    page.on('popup', () => {
      popupOpened = true;
    });

    await page.getByRole('button', {name: 'Connect a bank'}).click();
    const picker = page.getByTestId('bank-connection-picker');
    await picker.getByTestId('bank-connection-country-selector').click();
    await page.getByRole('option', {name: /Netherlands.*1 bank/}).click();
    await picker.getByTestId('bank-connection-bank-selector').click();
    await page.getByRole('option', {name: /Mock ASPSP.*NL/}).click();

    await expect(page.getByText('Bank connection added')).toBeVisible();
    await expect(page).toHaveURL(/\/bank-connections$/);
    expect(popupOpened).toBe(false);
  });

  test('keeps the connection overview usable at phone widths', async ({page}) => {
    await page.setViewportSize({width: 393, height: 852});
    await page.goto('/bank-connections');

    const heading = page.getByRole('heading', {name: 'Bank connections'});
    const headingGroup = page.getByTestId('bank-connections-heading');
    const connectButton = page.getByRole('button', {name: 'Connect a bank'}).first();
    const syncButton = page.getByRole('button', {name: 'Sync now'});
    const status = page.getByTestId('bank-connection-status');
    const freshness = page.getByTestId('bank-connection-freshness');

    await expect(heading).toBeVisible();
    await expect(connectButton).toBeVisible();
    await expect(syncButton).toBeVisible();
    await expect(page.getByText('Daily spending', {exact: true})).toBeVisible();

    const [headingBox, headingGroupBox, connectButtonBox, syncButtonBox, statusBox, freshnessBox] =
      await Promise.all([
        heading.boundingBox(),
        headingGroup.boundingBox(),
        connectButton.boundingBox(),
        syncButton.boundingBox(),
        status.boundingBox(),
        freshness.boundingBox(),
      ]);
    expect(headingBox).not.toBeNull();
    expect(headingGroupBox).not.toBeNull();
    expect(connectButtonBox).not.toBeNull();
    expect(syncButtonBox).not.toBeNull();
    expect(statusBox).not.toBeNull();
    expect(freshnessBox).not.toBeNull();
    expect(headingBox!.height).toBe(32);
    expect(headingGroupBox!.height).toBeLessThan(120);
    expect(connectButtonBox!.x).toBe(16);
    expect(syncButtonBox!.height).toBeGreaterThanOrEqual(44);
    const statusCenter = statusBox!.y + statusBox!.height / 2;
    const freshnessCenter = freshnessBox!.y + freshnessBox!.height / 2;
    const syncCenter = syncButtonBox!.y + syncButtonBox!.height / 2;
    expect(
      Math.max(statusCenter, freshnessCenter, syncCenter) -
        Math.min(statusCenter, freshnessCenter, syncCenter),
    ).toBeLessThan(1);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);

    const sidebarTrigger = page.locator('[data-sidebar="trigger"]');
    await sidebarTrigger.click();
    const mobileSidebar = page.locator('[data-sidebar="sidebar"][data-mobile="true"]');
    await expect(mobileSidebar).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(mobileSidebar).toBeHidden();
    await expect(sidebarTrigger).toBeFocused();
  });

  test('keeps the connection overview within a narrow phone viewport', async ({page}) => {
    await page.setViewportSize({width: 320, height: 852});
    await page.goto('/bank-connections');

    const connectionCard = page.locator('[data-testid^="bank-connection-"]').first();
    const syncButton = page.getByRole('button', {name: 'Sync now'});
    const sidebarTrigger = page.locator('[data-sidebar="trigger"]');

    await expect(page.getByRole('heading', {name: 'Accounts'})).toBeVisible();
    await expect(page.getByRole('heading', {name: 'Transactions'})).toBeVisible();
    await expect(syncButton).toBeVisible();
    await expect(sidebarTrigger).toBeVisible();

    const [connectionCardBox, syncButtonBox, sidebarTriggerBox] = await Promise.all([
      connectionCard.boundingBox(),
      syncButton.boundingBox(),
      sidebarTrigger.boundingBox(),
    ]);
    expect(connectionCardBox).not.toBeNull();
    expect(syncButtonBox).not.toBeNull();
    expect(sidebarTriggerBox).not.toBeNull();
    expect(connectionCardBox!.x + connectionCardBox!.width).toBeLessThanOrEqual(320);
    expect(syncButtonBox!.height).toBeGreaterThanOrEqual(44);
    expect(sidebarTriggerBox!.height).toBeGreaterThanOrEqual(44);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
  });

  test('supports enlarged text without horizontal overflow', async ({page}) => {
    await page.setViewportSize({width: 320, height: 852});
    await page.goto('/bank-connections');
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });

    const connectButton = page.getByRole('button', {name: 'Connect a bank'}).first();
    const connectButtonBox = await connectButton.boundingBox();

    expect(connectButtonBox).not.toBeNull();
    expect(connectButtonBox!.x + connectButtonBox!.width).toBeLessThanOrEqual(320);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
  });
});

test.describe('mocked Enable Banking bank connection', () => {
  test.use({storageState: VERIFIED_USER_AUTH_FILE});

  test('connects a mock account through the complete authorization callback', async ({page}) => {
    let connectionPersisted = false;
    let connectionDeleted = false;
    let authorizationRequest: {aspspName: string; aspspCountry: string} | undefined;
    let callbackRequest: URL | undefined;
    let callbackRedirectUrl = '';
    let providerCallbackUrl = '';

    await page.route('**/bank-connections/aspsps', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            ...TARGET_ASPSP,
            logoUrl: 'https://enablebanking.com/brands/NL/Mock-ASPSP/',
          },
        ]),
      });
    });

    await page.route('**/bank-connections', async (route) => {
      if (route.request().resourceType() === 'document') {
        await route.continue();
        return;
      }
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(connectionPersisted && !connectionDeleted ? [MOCK_CONNECTION] : []),
      });
    });

    await page.route('**/bank-connections/authorize', async (route) => {
      authorizationRequest = route.request().postDataJSON() as {
        aspspName: string;
        aspspCountry: string;
      };
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({authorizationUrl: `${MOCK_PROVIDER_ORIGIN}/consent`}),
      });
    });

    await page.route('**/bank-connections/callback**', async (route) => {
      callbackRequest = new URL(route.request().url());
      connectionPersisted = true;
      await route.fulfill({
        status: 302,
        headers: {location: callbackRedirectUrl},
      });
    });

    await page.route(`${MOCK_PROVIDER_ORIGIN}/consent`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<!doctype html>
<html>
  <body>
    <h1>Enable Banking</h1>
    <p>Mock ASPSP authorization</p>
    <button type="button" id="continue">Continue with authentication</button>
    <script>
      document.querySelector('#continue').addEventListener('click', () => {
        window.location.href = ${JSON.stringify(`${MOCK_PROVIDER_ORIGIN}/accounts`)};
      });
    </script>
  </body>
</html>`,
      });
    });

    await page.route(`${MOCK_PROVIDER_ORIGIN}/accounts`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<!doctype html>
<html>
  <body>
    <h1>Please select the account</h1>
    <label>
      <input type="checkbox" name="account" value="mock-account" />
      Mock current account
    </label>
    <button type="button" id="authorize">Authorize</button>
    <script>
      document.querySelector('#authorize').addEventListener('click', () => {
        window.location.href = ${JSON.stringify(providerCallbackUrl)};
      });
    </script>
  </body>
</html>`,
      });
    });

    await page.route(`**/bank-connections/${MOCK_CONNECTION.id}`, async (route) => {
      if (route.request().method() !== 'DELETE') {
        await route.continue();
        return;
      }

      expect(route.request().postDataJSON()).toEqual({confirmation: 'DELETE'});
      connectionDeleted = true;
      await route.fulfill({status: 204, body: ''});
    });

    await page.goto('/bank-connections');
    callbackRedirectUrl = new URL('/bank-connections?result=connected', page.url()).toString();
    const providerCallback = new URL('/bank-connections/callback', page.url());
    providerCallback.searchParams.set('state', 'mock-authorization-state');
    providerCallback.searchParams.set('code', 'mock-provider-code');
    providerCallbackUrl = providerCallback.toString();
    await expect(page.getByText('0 connections', {exact: true})).toBeVisible();

    await page.getByRole('button', {name: 'Connect a bank'}).click();
    const picker = page.getByTestId('bank-connection-picker');

    await picker.getByTestId('bank-connection-country-selector').click();
    await page.getByPlaceholder('Search countries...').fill(TARGET_ASPSP.country);
    await page.getByRole('option', {name: /Netherlands.*1 bank/}).click();

    await picker.getByTestId('bank-connection-bank-selector').click();
    await page.getByRole('option', {name: /Mock ASPSP.*NL/}).click();

    await expect
      .poll(() => authorizationRequest)
      .toEqual({
        aspspName: TARGET_ASPSP.name,
        aspspCountry: TARGET_ASPSP.country,
      });
    await expect(page).toHaveURL(`${MOCK_PROVIDER_ORIGIN}/consent`);
    await page.getByRole('button', {name: 'Continue with authentication'}).click();

    await expect(page).toHaveURL(`${MOCK_PROVIDER_ORIGIN}/accounts`);
    await expect(page.getByRole('heading', {name: 'Please select the account'})).toBeVisible();
    await page.getByRole('checkbox', {name: 'Mock current account'}).check();
    await page.getByRole('button', {name: 'Authorize', exact: true}).click();

    await expect(page.getByText('Bank connection added', {exact: true})).toBeVisible();
    await expect(page).toHaveURL(/\/bank-connections$/);
    await expect.poll(() => callbackRequest?.searchParams.get('code')).toBe('mock-provider-code');
    expect(callbackRequest?.searchParams.get('state')).toBe('mock-authorization-state');
    expect(connectionPersisted).toBe(true);

    const connectionCard = page.getByTestId(`bank-connection-${MOCK_CONNECTION.id}`);
    await expect(page.getByText('1 connection', {exact: true})).toBeVisible();
    await expect(connectionCard).toBeVisible();
    await expect(connectionCard.getByRole('heading', {name: TARGET_ASPSP.name})).toBeVisible();
    await expect(connectionCard.getByText('Connected', {exact: true})).toBeVisible();
    await expect(connectionCard.getByRole('heading', {name: 'Accounts'})).toBeVisible();
    await expect(connectionCard.getByText('Mock current account', {exact: true})).toBeVisible();
    await expect(connectionCard.getByText('Valid until', {exact: false})).toBeVisible();

    await connectionCard.getByRole('button', {name: 'Remove'}).click();
    await expect(page.getByRole('heading', {name: 'Remove connected bank?'})).toBeVisible();
    await page.getByTestId(`remove-bank-confirmation-${MOCK_CONNECTION.id}`).fill('DELETE');
    await page.getByTestId(`remove-bank-confirm-${MOCK_CONNECTION.id}`).click();

    await expect(page.getByText('Bank connection removed', {exact: true})).toBeVisible();
    await expect.poll(() => connectionDeleted).toBe(true);
    await expect(connectionCard).toHaveCount(0);
    await expect(page.getByText('0 connections', {exact: true})).toBeVisible();
  });
});

test.describe('bank connection loading errors', () => {
  test.use({storageState: VERIFIED_USER_AUTH_FILE});

  test('shows a retryable error when connections cannot load', async ({page}) => {
    let connectionRequests = 0;
    await page.route('**/bank-connections', async (route) => {
      if (route.request().resourceType() === 'document') {
        await route.continue();
        return;
      }

      connectionRequests += 1;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({message: 'Service unavailable'}),
      });
    });

    await page.goto('/bank-connections');

    await expect(page.getByRole('heading', {name: 'Bank connections', exact: true})).toBeVisible();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(
      page.getByRole('heading', {name: 'Could not load bank connections'}),
    ).toBeVisible();
    const retryButton = page.getByTestId('bank-connections-retry');
    await expect(retryButton).toBeVisible();
    const retryButtonBox = await retryButton.boundingBox();
    expect(retryButtonBox).not.toBeNull();
    expect(retryButtonBox!.height).toBeGreaterThanOrEqual(44);
    expect(connectionRequests).toBe(1);
  });
});

test.describe('bank connections without bank connections', () => {
  test.use({storageState: PW_CHANGE_USER_AUTH_FILE});

  test('shows the connect prompt without bank connections', async ({page}) => {
    await page.goto('/bank-connections');

    await expect(page.getByRole('heading', {name: 'No bank connections'})).toBeVisible();
    await expect(page.getByRole('button', {name: 'Connect a bank'})).toHaveCount(1);
  });
});
