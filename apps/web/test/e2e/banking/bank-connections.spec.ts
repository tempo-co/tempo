import {QueryObserver} from '@tanstack/react-query';

import {dashboardQueryKeys} from '../../../src/features/banking/api/aggregate-query-keys';
import {bankQueryKeys} from '../../../src/features/banking/api/query-keys';
import {recurringQueryKeys} from '../../../src/features/banking/api/recurring-query-keys';
import type {BankConnection} from '../../../src/features/banking/types/bank-connection';
import type {BankSyncRun} from '../../../src/features/banking/types/bank-sync-run';
import {VERIFIED_USER_AUTH_FILE} from '../../constants/auth.constants';
import {SEEDED_TRANSACTION_YEAR_NOW} from '../../constants/seed.constants';
import {successfulBankRefresh} from '../../data/bank-sync-run.data';
import {septemberSpending} from '../../data/home-summary.data';
import {API_URL, expect, test} from '../../fixtures';
import {
  fulfillJson,
  mockBalanceTrend,
  mockCashFlow,
  mockBankConnections,
  mockBankRefresh,
  mockJson,
  routeBankConnectionsApi,
  transformBankConnections,
} from '../../utils/api-mocks';
import {createHookHarness} from '../../utils/hook-harness';
import {boxOf, expectNoHorizontalOverflow} from '../../utils/layout';

const DETAIL_TRANSACTION_ID = '00000000-0000-4000-8000-000000000014';
const MOCK_PROVIDER_ORIGIN = 'https://enablebanking.test';
const TARGET_ASPSP = {name: 'Mock ASPSP', country: 'NL'};
const MONOCHROME_LOGO_URL = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 40"><text x="8" y="28" font-family="Arial" font-size="24" font-weight="700" fill="#000">MONO</text></svg>',
)}`;
const COLORED_LOGO_URL = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 40"><rect width="80" height="40" fill="#ef4444"/><rect x="80" width="80" height="40" fill="#2563eb"/></svg>',
)}`;
const PROVIDER_LOGO_URL = 'https://enablebanking.com/brands/NL/ABN-AMRO/';
// A 1x1 PNG served in place of the provider logo, so the test does not depend on the live CDN.
const PROVIDER_LOGO_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const MOCK_CONNECTION: BankConnection = {
  id: '00000000-0000-4000-8000-000000000096',
  provider: 'enable-banking',
  aspspName: TARGET_ASPSP.name,
  aspspCountry: TARGET_ASPSP.country,
  status: 'AUTHORIZED',
  consentValidUntil: '2030-01-01T00:00:00.000Z',
  lastSyncedAt: null,
  lastSyncError: null,
  nextSyncAt: '2030-01-01T00:00:00.000Z',
  syncStatus: 'SUCCEEDED',
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
    {
      id: '00000000-0000-4000-8000-000000000098',
      name: 'Mock savings account',
      details: 'Mock ASPSP savings account',
      alias: null,
      currency: 'EUR',
      cashAccountType: 'SVGS',
      usage: 'PRIV',
      maskedIdentifier: '****5678',
      currentBalanceAmount: '100.44',
      currentBalanceType: 'AVAILABLE',
      balanceUpdatedAt: null,
      isActive: true,
      latestBalances: [],
    },
  ],
};

const REFRESH_RESULT = {...successfulBankRefresh, transactionsAdded: 3} satisfies BankSyncRun;

test.describe('bank connections', () => {
  test.use({storageState: VERIFIED_USER_AUTH_FILE});

  test('polls while an automatic synchronization is queued', async ({page}) => {
    let requestCount = 0;
    await mockBankConnections(page, () => {
      requestCount += 1;
      const connection =
        requestCount === 1
          ? {
              ...MOCK_CONNECTION,
              syncStatus: 'QUEUED' as const,
              nextSyncAt: new Date(Date.now() + 60_000).toISOString(),
            }
          : MOCK_CONNECTION;
      return [connection];
    });

    await page.goto('/bank-connections');
    await expect(page.getByTestId('bank-connection-total')).toContainText('1,335.00');
    await expect(page.getByTestId('bank-connection-sync-status')).toHaveCount(0);
    await expect.poll(() => requestCount, {timeout: 12_000}).toBeGreaterThan(1);
    await expect(page.getByTestId('bank-connection-sync-status')).toHaveCount(0);
  });

  test('refreshes transactions after a later automatic synchronization', async ({page}) => {
    let connectionRequestCount = 0;
    let transactionRequestCount = 0;
    await mockBankConnections(page, () => {
      connectionRequestCount += 1;
      const connection = {
        ...MOCK_CONNECTION,
        syncStatus: connectionRequestCount === 1 ? ('QUEUED' as const) : ('SUCCEEDED' as const),
        lastSyncedAt:
          connectionRequestCount === 1 ? '2026-09-01T00:00:00.000Z' : '2026-09-02T00:00:00.000Z',
      };
      return [connection];
    });
    await page.route('**/bank-connections/*/transactions*', async (route) => {
      transactionRequestCount += 1;
      await fulfillJson(route, {transactions: [], total: transactionRequestCount});
    });

    await page.goto('/bank-connections');
    await expect(page.getByTestId('bank-connection-total')).toContainText('1,335.00');
    await expect(page.getByTestId('bank-connection-sync-status')).toHaveCount(0);
    // Recent transactions are only loaded once the card is expanded.
    expect(transactionRequestCount).toBe(0);

    await page.getByTestId(`connection-card-toggle-${MOCK_CONNECTION.id}`).click();
    await expect.poll(() => transactionRequestCount).toBe(1);
    await expect.poll(() => connectionRequestCount, {timeout: 12_000}).toBeGreaterThan(1);
    await expect.poll(() => transactionRequestCount, {timeout: 12_000}).toBeGreaterThan(1);
  });

  test('shows seeded connection data, callback feedback, and provider logo', async ({page}) => {
    await page.clock.setFixedTime(SEEDED_TRANSACTION_YEAR_NOW);
    await mockJson(page, '**/bank-connections/aspsps', [
      {name: 'ABN AMRO', country: 'NL', logoUrl: PROVIDER_LOGO_URL},
    ]);
    await page.route(PROVIDER_LOGO_URL, (route) =>
      route.fulfill({status: 200, contentType: 'image/png', body: PROVIDER_LOGO_PNG}),
    );

    await transformBankConnections(page, (connections) => {
      const seededConnection = connections.find(
        (connection) => connection.aspspName === 'ABN AMRO',
      );
      if (!seededConnection) throw new Error('Expected a seeded ABN AMRO connection');
      return [seededConnection];
    });

    await page.route('**/bank-connections/*/transactions**', async (route) => {
      const response = await route.fetch();
      const payload = (await response.json()) as {
        transactions: Array<Record<string, unknown>>;
        total: number;
      };
      const recentTransaction = payload.transactions.find(
        (transaction) => transaction.id === DETAIL_TRANSACTION_ID,
      );
      if (!recentTransaction) throw new Error('Expected the seeded detail bank transaction');

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
              financialEventRuleVersion: 'provider-currency-exchange-v1',
              cashFlowTreatment: 'INTERNAL',
            },
            ...payload.transactions.filter(
              (transaction) => transaction.id !== DETAIL_TRANSACTION_ID,
            ),
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
    await connectionCard.getByTestId(/^connection-card-toggle-/).click();
    await expect(connectionCard.getByRole('heading', {name: 'Accounts'})).toBeVisible();
    await expect(connectionCard.getByRole('heading', {name: 'Recent transactions'})).toBeVisible();
    await expect(connectionCard.getByText('Connected', {exact: true})).toBeVisible();
    await expect(connectionCard.getByTestId('bank-connection-freshness')).toContainText('Updated');

    const bankLogo = connectionCard.getByTestId('bank-connection-logo');
    await expect(bankLogo).toBeVisible();
    await expect(bankLogo.locator('img')).toHaveAttribute('src', PROVIDER_LOGO_URL);
    await expect(bankLogo).toHaveClass(/border-border/);
    await expect(bankLogo).toHaveClass(/bg-background/);
    await expect(bankLogo).toHaveCSS('width', '72px');
    await expect(bankLogo).toHaveCSS('height', '72px');
    await expect(bankLogo.locator('img')).toHaveCSS('padding', '6px');

    const status = connectionCard.getByTestId('bank-connection-status');
    const freshness = connectionCard.getByTestId('bank-connection-freshness');
    await expect(status).toBeVisible();
    await expect(freshness).toBeVisible();
    await expect(connectionCard.getByTestId('bank-connection-sync-status')).toHaveCount(0);
    await expect(connectionCard.getByText('Daily spending', {exact: true})).toBeVisible();
    await expect(connectionCard.getByText('Provider purchase')).toBeVisible();
    const transactionTrigger = connectionCard.getByRole('button', {
      name: 'View transaction details for Provider purchase',
    });
    await expect(transactionTrigger).toBeVisible();
    await expect(transactionTrigger).toHaveText('Provider purchase18 Aug-€12.50');
    const descriptionBox = await boxOf(
      transactionTrigger.getByText('Provider purchase', {exact: true}),
    );
    const dateBox = await boxOf(transactionTrigger.getByText('18 Aug', {exact: true}));
    const amountBox = await boxOf(transactionTrigger.getByText('-€12.50', {exact: true}));
    expect(dateBox.y).toBeGreaterThanOrEqual(descriptionBox.y + descriptionBox.height);
    expect(amountBox.x).toBeGreaterThan(descriptionBox.x + descriptionBox.width);
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

  for (const {syncStatus, title, description} of [
    {
      syncStatus: 'FAILED',
      title: 'Automatic sync needs attention',
      description: 'Synthetic bank refresh failed.',
    },
    {
      syncStatus: 'PARTIAL',
      title: 'Automatic sync is partial',
      description: 'Synthetic account refresh was incomplete.',
    },
    {
      syncStatus: 'RATE_LIMITED',
      title: 'Automatic sync is rate-limited',
      description: 'The bank is temporarily limiting background access.',
    },
    {
      syncStatus: 'EXPIRED',
      title: 'Re-authorization required',
      description: 'Consent expired.',
    },
  ] as const) {
    test(`shows the ${syncStatus} sync warning when the next sync is overdue`, async ({page}) => {
      await mockBankConnections(page, [
        {
          ...MOCK_CONNECTION,
          syncStatus,
          lastSyncedAt: '2020-01-01T00:00:00.000Z',
          nextSyncAt: '2020-01-02T00:00:00.000Z',
          lastSyncError: description,
        },
      ]);

      await page.goto('/bank-connections');
      const warning = page.getByTestId('bank-connection-sync-status');
      await expect(warning).toBeVisible();
      await expect(warning).toHaveAttribute('role', 'alert');
      await expect(warning).toContainText(title);
      await expect(warning).toContainText(description);
      await expect(page.getByRole('button', {name: 'Re-authorize'})).toHaveCount(
        syncStatus === 'EXPIRED' ? 1 : 0,
      );
    });
  }

  for (const syncStatus of ['QUEUED', 'RUNNING'] as const) {
    test(`keeps ${syncStatus} automatic sync silent while polling`, async ({page}) => {
      let requestCount = 0;
      await mockBankConnections(page, () => {
        requestCount += 1;
        return [
          {
            ...MOCK_CONNECTION,
            syncStatus,
            lastSyncedAt: '2020-01-01T00:00:00.000Z',
            nextSyncAt: '2020-01-02T00:00:00.000Z',
          },
        ];
      });

      await page.goto('/bank-connections');
      await expect(page.getByTestId('bank-connection-total')).toContainText('1,335.00');
      await expect(page.getByTestId('bank-connection-sync-status')).toHaveCount(0);
      await expect.poll(() => requestCount, {timeout: 12_000}).toBeGreaterThan(1);
      await expect(page.getByTestId('bank-connection-sync-status')).toHaveCount(0);
    });
  }

  test('requires re-authorization when consent is missing', async ({page}) => {
    await mockBankConnections(page, [{...MOCK_CONNECTION, consentValidUntil: null}]);

    await page.goto('/bank-connections');
    await expect(page.getByRole('button', {name: 'Re-authorize'})).toBeVisible();
    await expect(page.getByTestId('bank-connection-sync-status')).toContainText(
      'Re-authorization required',
    );
  });

  test('requires re-authorization when persisted consent has expired', async ({page}) => {
    await transformBankConnections(page, (connections) =>
      connections.map((connection) => ({
        ...connection,
        status: 'AUTHORIZED',
        consentValidUntil: '2020-01-01T00:00:00.000Z',
        syncStatus: 'SUCCEEDED',
        nextSyncAt: '2030-01-01T00:00:00.000Z',
      })),
    );

    await page.goto('/bank-connections');

    const syncStatus = page.getByTestId('bank-connection-sync-status').first();
    await expect(syncStatus).toContainText('Re-authorization required');
    await expect(page.getByRole('button', {name: 'Re-authorize'})).toBeVisible();
  });

  test('does not present background sync for an incomplete authorization', async ({page}) => {
    await transformBankConnections(page, (connections) =>
      connections.map((connection) => ({
        ...connection,
        status: 'PENDING_AUTHORIZATION',
        consentValidUntil: null,
        lastSyncedAt: null,
        nextSyncAt: null,
        syncStatus: 'IDLE',
      })),
    );

    await page.goto('/bank-connections');

    await expect(page.getByTestId('bank-connection-sync-status')).toHaveCount(0);
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
      lastSyncError: null,
      nextSyncAt: null,
      syncStatus: 'IDLE',
      bankAccounts: [],
    };

    await transformBankConnections(page, (connections) =>
      pendingConnectionVisible ? [...connections, pendingConnection] : connections,
    );
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
    await page.setViewportSize({width: 393, height: 852});
    const connectedConnectionId = '00000000-0000-4000-8000-000000000097';
    let connectedConnectionVisible = true;
    let deleteCalled = false;

    await transformBankConnections(page, (connections) => {
      const connectedConnection = {
        ...connections[0],
        id: connectedConnectionId,
        status: 'AUTHORIZED',
        lastSyncedAt: null,
      };
      return connectedConnectionVisible ? [connectedConnection] : [];
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
    await connectedCard.getByTestId(/^connection-card-toggle-/).click();
    await connectedCard.getByRole('button', {name: 'Remove'}).click();
    await expect(page.getByRole('heading', {name: 'Remove connected bank?'})).toBeVisible();
    const removeCancelButton = page.getByRole('button', {name: 'Cancel'});
    await expect(removeCancelButton).toBeVisible();
    expect(
      await removeCancelButton.evaluate(
        (element) => getComputedStyle(element.parentElement!).paddingBottom,
      ),
    ).toBe('16px');
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
    await page.setViewportSize({width: 393, height: 852});
    let releaseResponse!: () => void;
    const responseHeld = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    let authorizationRequest: {aspspName: string; aspspCountry: string} | undefined;

    await page.route('**/bank-connections/aspsps', async (route) => {
      await responseHeld;
      await fulfillJson(route, [
        {name: 'Colorful Bank', country: 'NL', logoUrl: COLORED_LOGO_URL},
        {name: 'Monochrome Bank', country: 'NL', logoUrl: MONOCHROME_LOGO_URL},
        {name: 'Other Bank', country: 'FI', logoUrl: COLORED_LOGO_URL},
      ]);
    });
    await page.route('**/bank-connections/authorize', async (route) => {
      authorizationRequest = JSON.parse(route.request().postData() || '{}') as {
        aspspName: string;
        aspspCountry: string;
      };
      await fulfillJson(
        route,
        {authorizationUrl: 'https://auth.example.test/monochrome-bank'},
        201,
      );
    });
    await page.route('https://auth.example.test/monochrome-bank', async (route) => {
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
    await expect(countrySelector).toBeVisible();
    await expect(countrySelector).toBeDisabled();
    await expect(bankSelector).toBeVisible();
    await expect(bankSelector).toBeDisabled();
    const [pickerBox, countrySelectorBox] = await Promise.all([
      boxOf(picker),
      boxOf(countrySelector),
    ]);
    expect(countrySelectorBox.x).toBeGreaterThanOrEqual(pickerBox.x + 16);
    expect(countrySelectorBox.x + countrySelectorBox.width).toBeLessThanOrEqual(
      pickerBox.x + pickerBox.width - 16,
    );
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
    const monochromeOption = page.getByRole('option', {name: /Monochrome Bank.*NL/});
    await expect(monochromeOption).toBeVisible();
    const monochromeLogo = monochromeOption.getByTestId('bank-logo');
    await expect(monochromeLogo).toBeVisible();
    await expect(monochromeLogo).toHaveAttribute('data-logo-analysis', 'monochrome');
    await expect(monochromeLogo).toHaveClass(/border-border/);
    await expect(monochromeLogo).toHaveClass(/bg-background/);
    await expect(monochromeLogo).toHaveCSS('width', '48px');
    await expect(monochromeLogo).toHaveCSS('height', '48px');
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    await expect(monochromeLogo.locator('img')).toHaveCSS('filter', 'none');
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await expect(monochromeLogo.locator('img')).toHaveCSS('filter', 'brightness(0) invert(1)');

    const coloredOption = page.getByRole('option', {name: /Colorful Bank.*NL/});
    const coloredLogo = coloredOption.getByTestId('bank-logo');
    await expect(coloredLogo).toHaveAttribute('data-logo-analysis', 'color');
    await expect(coloredLogo.locator('img')).toHaveCSS('filter', 'none');
    await monochromeOption.click();

    const confirmButton = picker.getByTestId('bank-connection-confirm');
    await expect(confirmButton).toBeEnabled();
    await expect(confirmButton).toContainText('Continue with Monochrome Bank');
    const redirectHint = picker.getByText(
      'You will be redirected to Monochrome Bank to approve access.',
      {exact: true},
    );
    await expect(redirectHint).toBeVisible();
    expect(
      await redirectHint.evaluate(
        (element) => getComputedStyle(element.parentElement!).paddingBottom,
      ),
    ).toBe('16px');
    const confirmButtonBox = await boxOf(confirmButton);
    expect(confirmButtonBox.x).toBeGreaterThanOrEqual(pickerBox.x + 16);
    expect(confirmButtonBox.x + confirmButtonBox.width).toBeLessThanOrEqual(
      pickerBox.x + pickerBox.width - 16,
    );
    await confirmButton.click();

    await expect
      .poll(() => authorizationRequest)
      .toEqual({aspspName: 'Monochrome Bank', aspspCountry: 'NL'});
    await expect(page).toHaveURL('https://auth.example.test/monochrome-bank');
  });

  test('reopens a connection transaction inspector from its shareable URL', async ({page}) => {
    await page.goto('/bank-connections');

    const card = page
      .locator('[data-testid^="bank-connection-"][aria-labelledby]')
      .filter({has: page.getByRole('heading', {name: /ABN AMRO|Mock ASPSP/})})
      .first();
    await expect(card).toBeVisible();
    await card.getByTestId(/^connection-card-toggle-/).click();

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
    await mockJson(page, '**/bank-connections/aspsps', [
      {
        name: 'Mock ASPSP',
        country: 'NL',
        logoUrl: 'https://enablebanking.com/brands/NL/Mock-ASPSP/',
      },
    ]);
    await mockJson(page, '**/bank-connections/authorize', {authorizationUrl}, 201);
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
    await picker.getByTestId('bank-connection-confirm').click();

    await expect(page.getByText('Bank connection added')).toBeVisible();
    await expect(page).toHaveURL(/\/bank-connections$/);
    expect(popupOpened).toBe(false);
  });

  test('keeps the connection overview usable at phone widths', async ({page}) => {
    await mockBankRefresh(page);
    await page.setViewportSize({width: 393, height: 852});
    await page.goto('/bank-connections');

    const heading = page.getByRole('heading', {name: 'Bank connections'});
    const headingGroup = page.getByTestId('bank-connections-heading');
    const connectButton = page.getByRole('button', {name: 'Connect a bank'}).first();
    const connectionCard = page
      .locator('[data-testid^="bank-connection-"][aria-labelledby]')
      .first();
    const status = page.getByTestId('bank-connection-status');
    const freshness = page.getByTestId('bank-connection-freshness');
    const totalBalance = page.getByTestId('bank-connection-total');
    const connectionTitle = connectionCard.getByRole('heading', {name: 'ABN AMRO'});

    await expect(heading).toBeVisible();
    await expect(connectButton).toBeVisible();
    await expect(connectionCard).toBeVisible();
    await expect(totalBalance).toBeVisible();
    await expect(totalBalance).toHaveAttribute('role', 'group');
    await expect(totalBalance).toHaveAttribute('aria-label', /^Connection balances:/);
    const [closedCardBox, titleBox, totalBox] = await Promise.all([
      boxOf(connectionCard),
      boxOf(connectionTitle),
      boxOf(totalBalance),
    ]);
    expect(closedCardBox.height).toBeLessThan(130);
    expect(totalBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height);
    expect(totalBox.x).toBeCloseTo(titleBox.x, 0);
    await connectionCard.getByTestId(/^connection-card-toggle-/).click();
    await expect(page.getByTestId('bank-connection-sync-status')).toHaveCount(0);
    await expect(page.getByText('Daily spending', {exact: true})).toBeVisible();
    await expect(freshness).toBeVisible();
    await expect(connectionCard.locator('footer')).not.toContainText('·', {useInnerText: true});

    const [headingBox, headingGroupBox, connectButtonBox] = await Promise.all([
      boxOf(heading),
      boxOf(headingGroup),
      boxOf(connectButton),
      boxOf(status),
      boxOf(freshness),
    ]);
    expect(headingBox.height).toBe(32);
    expect(headingGroupBox.height).toBeLessThan(120);
    expect(connectButtonBox.x).toBe(16);
    await expectNoHorizontalOverflow(page);
  });

  test('wraps multiple currency totals without phone overflow', async ({page}) => {
    const multiCurrencyConnection: BankConnection = {
      ...MOCK_CONNECTION,
      bankAccounts: [
        ...MOCK_CONNECTION.bankAccounts,
        {
          ...MOCK_CONNECTION.bankAccounts[0],
          id: '00000000-0000-4000-8000-000000000099',
          name: 'Mock USD account',
          currency: 'USD',
          currentBalanceAmount: '50.00',
          maskedIdentifier: '****9012',
        },
      ],
    };
    await page.setViewportSize({width: 320, height: 852});
    await mockBankConnections(page, [multiCurrencyConnection]);
    await page.goto('/bank-connections');

    const connectionCard = page
      .locator('[data-testid^="bank-connection-"][aria-labelledby]')
      .first();
    const totalBalance = connectionCard.getByTestId('bank-connection-total');
    await expect(totalBalance).toHaveAttribute('aria-label', /EUR.*USD/);
    const [cardBox, totalBox] = await Promise.all([boxOf(connectionCard), boxOf(totalBalance)]);
    expect(totalBox.x + totalBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
    await expectNoHorizontalOverflow(page);
  });

  const zeroBalanceCases = [
    {
      name: 'hides zero currency totals next to a non-zero total',
      balances: [
        {currency: 'EUR', amount: '25.00'},
        {currency: 'GBP', amount: '0.00'},
        {currency: 'USD', amount: '0'},
      ],
      expectedLabel: 'Connection balances: 25 EUR',
    },
    {
      name: 'keeps a single zero currency total',
      balances: [{currency: 'EUR', amount: '0.00'}],
      expectedLabel: 'Connection balances: 0 EUR',
    },
  ];

  for (const {name, balances, expectedLabel} of zeroBalanceCases) {
    test(name, async ({page}) => {
      await mockBankConnections(page, [
        {
          ...MOCK_CONNECTION,
          bankAccounts: balances.map(({currency, amount}, index) => ({
            ...MOCK_CONNECTION.bankAccounts[0],
            id: `00000000-0000-4000-8000-00000000010${index}`,
            currency,
            currentBalanceAmount: amount,
          })),
        },
      ]);
      await page.goto('/bank-connections');

      const totalBalance = page.getByTestId('bank-connection-total');
      await expect(totalBalance).toHaveAttribute('aria-label', expectedLabel);
      await expect(totalBalance.locator(':scope > span')).toHaveCount(1);
    });
  }

  test('keeps the connection overview within a narrow phone viewport', async ({page}) => {
    await page.setViewportSize({width: 320, height: 852});
    await page.goto('/bank-connections');

    const connectionCard = page
      .locator('[data-testid^="bank-connection-"][aria-labelledby]')
      .first();
    const activeTab = page.getByTestId('app-tab-bar').getByRole('link', {name: 'Connections'});

    await expect(connectionCard).toBeVisible();
    await connectionCard.getByTestId(/^connection-card-toggle-/).click();
    await expect(page.getByRole('heading', {name: 'Accounts'})).toBeVisible();
    await expect(page.getByRole('heading', {name: 'Transactions'})).toBeVisible();
    await expect(page.getByTestId('bank-connection-sync-status')).toHaveCount(0);
    await expect(activeTab).toHaveAttribute('aria-current', 'page');

    const [connectionCardBox, activeTabBox] = await Promise.all([
      boxOf(connectionCard),
      boxOf(activeTab),
    ]);
    expect(connectionCardBox.x + connectionCardBox.width).toBeLessThanOrEqual(320);
    expect(activeTabBox.height).toBeGreaterThanOrEqual(44);
    await expectNoHorizontalOverflow(page);
  });

  test('supports enlarged text without horizontal overflow', async ({page}) => {
    await page.setViewportSize({width: 320, height: 852});
    await page.goto('/bank-connections');
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });

    const connectButton = page.getByRole('button', {name: 'Connect a bank'}).first();
    const connectButtonBox = await boxOf(connectButton);
    expect(connectButtonBox.x + connectButtonBox.width).toBeLessThanOrEqual(320);
    await expectNoHorizontalOverflow(page);
  });
});

test.describe('mocked Enable Banking bank connection', () => {
  test.use({storageState: {cookies: [], origins: []}, serviceWorkers: 'block'});

  test.beforeEach(async ({page, baseURL}) => {
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
      if (url.origin === API_URL && url.pathname.endsWith('/refresh')) return fulfillJson(route, REFRESH_RESULT);
      await route.abort('blockedbyclient');
      throw new Error(`Unmocked request: ${route.request().method()} ${url}`);
    });
  });

  test('explains a synchronization conflict that arrives while the removal dialog is open', async ({
    page,
  }) => {
    let running = false;
    await mockBankConnections(page, () => [
      {...MOCK_CONNECTION, syncStatus: running ? 'RUNNING' : 'SUCCEEDED'},
    ]);
    await page.goto('/bank-connections');
    const card = page.getByTestId(`bank-connection-${MOCK_CONNECTION.id}`);
    await card.getByTestId(/^connection-card-toggle-/).click();
    await card.getByRole('button', {name: 'Remove connection'}).click();
    await page.getByTestId(`remove-bank-confirmation-${MOCK_CONNECTION.id}`).fill('DELETE');
    const confirm = page.getByRole('button', {name: 'Remove permanently', exact: true});
    await expect(confirm).toBeEnabled();
    running = true;
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {value: 'hidden', configurable: true});
      window.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'visibilityState', {value: 'visible', configurable: true});
      window.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(confirm).toBeDisabled();
    await expect(
      page.getByText(
        'Bank sync is in progress. Wait for it to finish before removing this connection.',
        {exact: true},
      ),
    ).toBeVisible();
  });

  for (const {name, status, message} of [
    {
      name: 'a concurrent synchronization',
      status: 409,
      message: 'A bank synchronization is already in progress.',
    },
    {
      name: 'an unauthorized bank connection',
      status: 409,
      message: 'Bank connection is not authorized.',
    },
    {
      name: 'an unavailable API',
      status: 503,
      message: 'Tempo is temporarily unavailable. Please try again.',
    },
  ]) {
    test(`shows ${name} without automatically retrying the refresh`, async ({page}) => {
      let requests = 0;
      await page.clock.install();
      await mockBankConnections(page, [MOCK_CONNECTION]);
      await page.route(`**/bank-connections/${MOCK_CONNECTION.id}/refresh`, (route) => {
        requests++;
        return fulfillJson(route, {message}, status);
      });
      await page.goto('/bank-connections');
      await expect(page.getByText('Bank refresh failed', {exact: true})).toBeVisible();
      await page.clock.runFor(60_000);
      expect(requests).toBe(1);
    });
  }

  test('reports a lost refresh response once and never replays it on reconnect', async ({
    page,
  }) => {
    let requests = 0;
    let unreachable = false;
    await page.clock.install();
    await routeBankConnectionsApi(page, (route) =>
      unreachable ? route.abort('failed') : fulfillJson(route, [MOCK_CONNECTION]),
    );
    await page.route(`${API_URL}/health`, (route) =>
      unreachable ? route.abort('failed') : fulfillJson(route, {}),
    );
    await page.route(`**/bank-connections/${MOCK_CONNECTION.id}/refresh`, (route) => {
      requests++;
      unreachable = true;
      return route.abort('failed');
    });
    await page.goto('/bank-connections');
    await expect.poll(() => requests).toBe(1);
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(1);
    await expect(page.locator('[data-sonner-toast]')).toContainText('Cannot reach Tempo.');
    await expect(page.getByRole('status').filter({hasText: /^Offline/})).toBeVisible();
    unreachable = false;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.clock.runFor(60_000);
    expect(requests).toBe(1);
    await page.reload();
    await expect.poll(() => requests).toBe(2);
  });

  test('handles pending and completed connection removal during foreground refresh', async ({page}) => {
    const first = {...MOCK_CONNECTION, id: '00000000-0000-4000-8000-000000000091'};
    const requests: string[] = [];
    let reads = 0;
    let includeFirst = false;
    let removed = false;
    let removalAttempts = 0;
    let releaseRemoval!: () => void;
    const held = new Promise<void>((resolve) => (releaseRemoval = resolve));
    let releaseRefresh!: () => void;
    const refreshHeld = new Promise<void>((resolve) => (releaseRefresh = resolve));
    await mockBankConnections(page, () => {
      reads++;
      return [...(includeFirst ? [first] : []), ...(removed ? [] : [MOCK_CONNECTION])];
    });
    await page.route('**/bank-connections/*/refresh', async (route) => {
      const id = new URL(route.request().url()).pathname.split('/')[2];
      requests.push(id);
      if (id === first.id) await refreshHeld;
      await fulfillJson(route, removed && id === MOCK_CONNECTION.id ? {message: 'Not found'} : REFRESH_RESULT, removed && id === MOCK_CONNECTION.id ? 404 : 200);
    });
    await page.route(`**/bank-connections/${first.id}/transactions*`, (route) =>
      fulfillJson(route, {transactions: [], total: 0}),
    );
    await page.route(`**/bank-connections/${MOCK_CONNECTION.id}/transactions*`, (route) =>
      fulfillJson(route, {transactions: [], total: 0}),
    );
    await page.route(`**/bank-connections/${MOCK_CONNECTION.id}`, async (route) => {
      expect(route.request().method()).toBe('DELETE');
      removalAttempts++;
      if (removalAttempts === 1) {
        await held;
        await fulfillJson(route, {message: 'Unavailable'}, 503);
      } else {
        removed = true;
        await route.fulfill({status: 204, body: ''});
      }
    });
    await page.goto('/bank-connections');
    const card = page.getByTestId(`bank-connection-${MOCK_CONNECTION.id}`);
    await expect.poll(() => requests).toEqual([MOCK_CONNECTION.id]);
    await card.getByTestId(/^connection-card-toggle-/).click();
    await expect(card.getByRole('button', {name: 'Remove connection'})).toBeEnabled();
    await card.getByRole('button', {name: 'Remove connection'}).click();
    await page.getByTestId(`remove-bank-confirmation-${MOCK_CONNECTION.id}`).fill('DELETE');
    await page.getByRole('button', {name: 'Remove permanently', exact: true}).click();
    try {
      await expect(page.getByRole('button', {name: 'Removing...'})).toBeDisabled();
      await page.getByRole('button', {name: 'Cancel', exact: true}).click();
      const before = reads;
      await page.evaluate(() => {
        for (const value of ['hidden', 'visible']) {
          Object.defineProperty(document, 'visibilityState', {value, configurable: true});
          window.dispatchEvent(new Event('visibilitychange'));
        }
      });
      await expect.poll(() => reads).toBeGreaterThan(before);
      await expect(card.getByRole('button', {name: 'Remove connection'})).toBeDisabled();
      expect(requests).toEqual([MOCK_CONNECTION.id]);
    } finally {
      releaseRemoval();
    }
    await expect(card.getByRole('button', {name: 'Remove connection'})).toBeEnabled();

    includeFirst = true;
    await page.evaluate(() => {
      for (const value of ['hidden', 'visible']) {
        Object.defineProperty(document, 'visibilityState', {value, configurable: true});
        window.dispatchEvent(new Event('visibilitychange'));
      }
    });
    const firstCard = page.getByTestId(`bank-connection-${first.id}`);
    let readsBeforeSettle = Number.POSITIVE_INFINITY;
    try {
      await expect.poll(() => requests).toEqual([MOCK_CONNECTION.id, first.id]);
      await card.getByRole('button', {name: 'Remove connection'}).click();
      await page.getByTestId(`remove-bank-confirmation-${MOCK_CONNECTION.id}`).fill('DELETE');
      await page.getByRole('button', {name: 'Remove permanently', exact: true}).click();
      await expect(page.getByText('Bank connection removed', {exact: true})).toBeVisible();
      await expect(card).toHaveCount(0);
      // A settled refresh re-reads the saved connections.
      readsBeforeSettle = reads;
    } finally {
      releaseRefresh();
    }
    await expect.poll(() => reads).toBeGreaterThan(readsBeforeSettle);
    await expect(firstCard).toBeVisible();
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(requests).toEqual([MOCK_CONNECTION.id, first.id]);
  });

  test('shows an API request limit as one shared error toast with retry guidance', async ({
    page,
  }) => {
    await mockBankConnections(page, [MOCK_CONNECTION]);
    await page.route(`**/bank-connections/${MOCK_CONNECTION.id}/refresh`, (route) =>
      route.fulfill({
        status: 429,
        headers: {'Retry-After': '90'},
        contentType: 'application/json',
        body: JSON.stringify({
          statusCode: 429,
          message:
            'Bank access is temporarily rate-limited. The next automatic attempt will wait for the provider cooldown.',
          error: 'Too Many Requests',
          rateLimitSource: 'enable-banking',
          retryAfterSeconds: 90,
        }),
      }),
    );
    await page.goto('/bank-connections');
    await expect(page.getByText('Rate limit exceeded', {exact: true})).toBeVisible();
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(1);
    await expect(page.locator('[data-sonner-toast]')).toContainText(
      'Please try again in about 2 minutes.',
    );
  });

  for (const {name, body, headers, guidance} of [
    {
      name: 'uses a readable Retry-After header before JSON retry timing',
      body: '{"retryAfterSeconds":90}',
      headers: {'Retry-After': '30', 'Access-Control-Expose-Headers': 'Retry-After'},
      guidance: 'Please try again in about 30 seconds.',
    },
    {
      name: 'uses zero JSON retry timing',
      body: '{"retryAfterSeconds":0}',
      headers: undefined,
      guidance: 'Please try again in about 1 second.',
    },
    ...[
      {
        name: 'an ordinary request limit',
        body: '{"statusCode":429,"message":"Too many requests. Try again later.","error":"Too Many Requests"}',
      },
      {name: 'malformed JSON', body: '{invalid'},
      {name: 'a null body', body: 'null'},
      {name: 'nonnumeric JSON retry timing', body: '{"retryAfterSeconds":"90"}'},
      {name: 'negative JSON retry timing', body: '{"retryAfterSeconds":-1}'},
      {name: 'nonfinite JSON retry timing', body: '{"retryAfterSeconds":1e400}'},
      {name: 'unsafe JSON retry timing', body: '{"retryAfterSeconds":1e30}'},
    ].map(({name, body}) => ({
      name: `uses generic retry guidance for ${name}`,
      body,
      headers: undefined,
      guidance: 'Please try again later.',
    })),
  ]) {
    test(`${name} for a rate-limited refresh`, async ({page}) => {
      await mockBankConnections(page, [MOCK_CONNECTION]);
      await page.route(`**/bank-connections/${MOCK_CONNECTION.id}/refresh`, (route) =>
        route.fulfill({status: 429, headers, contentType: 'application/json', body}),
      );
      await page.goto('/bank-connections');
      await expect(page.getByText('Rate limit exceeded', {exact: true})).toBeVisible();
      await expect(page.locator('[data-sonner-toast]')).toHaveCount(1);
      await expect(page.locator('[data-sonner-toast]')).toContainText(guidance);
    });
  }

  test('cancels foreground refresh at logout intent and discards its late response body', async ({
    page,
    homePage,
  }) => {
    await page.addInitScript(() => {
      const fetch = window.fetch.bind(window);
      window.fetch = async (...args) => {
        const url = typeof args[0] === 'string' ? args[0] : args[0] instanceof URL ? args[0].href : args[0].url;
        if (url.endsWith('/refresh')) args[1]?.signal?.addEventListener('abort', () => {
          document.documentElement.dataset.refreshAborted = 'true';
        }, {once: true});
        const response = await fetch(...args);
        if (response.url.endsWith('/refresh') && response.status === 429) {
          const readJson = response.json.bind(response);
          response.json = async () => {
            document.documentElement.dataset.refreshBody = 'pending';
            await new Promise<void>((resolve) =>
              window.addEventListener('release-refresh-body', () => resolve(), {once: true}),
            );
            try {
              const body: unknown = await readJson();
              return body;
            } finally {
              document.documentElement.dataset.refreshBody = 'read';
            }
          };
        }
        return response;
      };
    });
    await mockBankConnections(page, [MOCK_CONNECTION]);
    await page.route(`**/bank-connections/${MOCK_CONNECTION.id}/refresh`, (route) =>
      fulfillJson(route, {retryAfterSeconds: 90}, 429),
    );
    let releaseLogout!: () => void;
    const logoutHeld = new Promise<void>((resolve) => (releaseLogout = resolve));
    await page.route(`${API_URL}/auth/logout`, async (route) => {
      await logoutHeld;
      await fulfillJson(route, {});
    });
    await page.goto('/bank-connections');
    try {
      await expect(page.locator('html')).toHaveAttribute('data-refresh-body', 'pending');
      await homePage.logOut();
      await expect(page.locator('html')).toHaveAttribute('data-refresh-aborted', 'true');
    } finally {
      releaseLogout();
      await page.evaluate(() => window.dispatchEvent(new Event('release-refresh-body')));
    }
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator('html')).toHaveAttribute('data-refresh-body', 'read');
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(await page.getByText('Rate limit exceeded', {exact: true}).count()).toBe(0);
  });

  for (const syncStatus of ['QUEUED', 'RUNNING'] as const) {
    test(`blocks removal while bank sync is ${syncStatus}`, async ({page}) => {
      await mockBankConnections(page, [{...MOCK_CONNECTION, syncStatus}]);
      await page.goto('/bank-connections');
      const card = page.getByTestId(`bank-connection-${MOCK_CONNECTION.id}`);
      await card.getByTestId(/^connection-card-toggle-/).click();
      await expect(card.getByRole('button', {name: 'Remove connection'})).toBeDisabled();
    });
  }

  test('opens saved bank data offline without replaying refresh work on reconnect', async ({page}) => {
    let requests = 0;
    await page.clock.install();
    await mockBankConnections(page, [MOCK_CONNECTION]);
    await page.route(`**/bank-connections/${MOCK_CONNECTION.id}/refresh`, (route) => {
      requests++;
      return fulfillJson(route, REFRESH_RESULT);
    });
    await page.goto('/bank-connections');
    const card = page.getByTestId(`bank-connection-${MOCK_CONNECTION.id}`);
    await expect.poll(() => requests).toBe(1);
    await expect(card).toBeVisible();
    await page.clock.runFor(1100);
    await expect.poll(() => page.evaluate(() => !!localStorage.getItem('tempo-offline-cache'))).toBe(true);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'onLine', {value: false, configurable: true});
    });
    let checkHeld = false;
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(`${API_URL}/accounts/me`, async (route) => {
      checkHeld = true;
      await held;
      await route.fallback();
    });
    await page.reload();
    await expect(card).toBeVisible();
    await expect(page.getByRole('status').filter({hasText: /^Offline/})).toBeVisible();
    expect(requests).toBe(1);
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', {value: true, configurable: true});
      window.dispatchEvent(new Event('online'));
    });
    try {
      await expect.poll(() => checkHeld).toBe(true);
      expect(requests).toBe(1);
      await expect(card).toBeVisible();
    } finally {
      release();
    }
    await page.clock.resume();
    await expect(page.getByRole('status').filter({hasText: /^Offline/})).toHaveCount(0);
    await page.clock.runFor(60_000);
    expect(requests).toBe(1);
    await page.evaluate(() => {
      for (const value of ['hidden', 'visible']) {
        Object.defineProperty(document, 'visibilityState', {value, configurable: true});
        window.dispatchEvent(new Event('visibilitychange'));
      }
    });
    await expect.poll(() => requests).toBe(2);
  });

  for (const outcome of ['conflict', 'FAILED', 'PARTIAL'] as const) {
    test(`shows expired consent discovered by a ${outcome} refresh and offers re-authorization`, async ({
      page,
    }) => {
      let expired = false;
      await mockBankConnections(page, () => [
        {
          ...MOCK_CONNECTION,
          status: expired ? 'EXPIRED' : 'AUTHORIZED',
          syncStatus: expired ? 'EXPIRED' : 'SUCCEEDED',
        },
      ]);
      await page.route(`**/bank-connections/${MOCK_CONNECTION.id}/refresh`, (route) => {
        expired = true;
        const errorMessage = 'Bank consent has expired. Please reconnect.';
        return outcome === 'conflict'
          ? fulfillJson(route, {message: errorMessage}, 409)
          : fulfillJson(route, {
              ...REFRESH_RESULT,
              status: outcome,
              errorMessage,
              transactionsAdded: outcome === 'PARTIAL' ? 1 : 0,
            });
      });
      await page.goto('/bank-connections');
      const card = page.getByTestId(`bank-connection-${MOCK_CONNECTION.id}`);
      await expect(
        page.getByText(outcome === 'PARTIAL' ? 'Bank refresh incomplete' : 'Bank refresh failed', {
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.locator('[data-sonner-toast]')).toContainText(
        'Bank consent has expired. Please reconnect.',
      );
      await expect(card.getByRole('button', {name: 'Re-authorize', exact: true})).toBeVisible();
      await expect(card.getByTestId('bank-connection-status')).toContainText('Expired');
    });
  }

  for (const status of ['FAILED', 'PARTIAL'] as const) {
    test(`shows the bank rate limit for a ${status} refresh without scheduling a retry`, async ({
      page,
    }) => {
      let requests = 0;
      await page.clock.install();
      await mockBankConnections(page, [MOCK_CONNECTION]);
      await page.route(`**/bank-connections/${MOCK_CONNECTION.id}/refresh`, (route) => {
        requests++;
        return fulfillJson(route, {
          ...REFRESH_RESULT,
          status,
          transactionsAdded: status === 'PARTIAL' ? 1 : 0,
          rateLimitSource: 'enable-banking',
          retryAfterSeconds: 120,
          errorMessage: 'Example bank request limit reached.',
        });
      });
      await page.goto('/bank-connections');
      await expect(page.getByText('Bank refresh rate-limited', {exact: true})).toBeVisible();
      await expect(page.locator('[data-sonner-toast]')).toContainText(
        'Example bank request limit reached. Please try again in about 2 minutes.',
      );
      await page.clock.runFor(180_000);
      expect(requests).toBe(1);
    });
  }

  test('refreshes the next signed-in account without dispatching the previous account tail', async ({page, homePage, loginPage}) => {
    const next = {...MOCK_CONNECTION, id: '00000000-0000-4000-8000-000000000093'};
    const tail = {...MOCK_CONNECTION, id: '00000000-0000-4000-8000-000000000092'};
    let nextSession = false;
    const requests: string[] = [];
    await mockBankConnections(page, () => nextSession ? [next] : [MOCK_CONNECTION, tail]);
    await mockBalanceTrend(page);
    await mockCashFlow(page);
    await mockJson(page, '**/bank-transactions/summary**', septemberSpending('1200.00'));
    await mockJson(page, '**/recurring-series/summary?**', {expenseMonthlyTotal: '0.00', incomeMonthlyTotal: '0.00', upcoming: []});
    await mockJson(page, '**/bank-transactions/review-counts', {needsReview: 0, categorizationFailed: 0, categorizing: 0, unknownDirection: 0, missingBaseAmount: 0});
    await mockJson(page, '**/bank-transactions?**', {transactions: [], total: 0});
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/bank-connections/*/refresh', async (route) => {
      const id = new URL(route.request().url()).pathname.split('/')[2];
      requests.push(id);
      if (id === MOCK_CONNECTION.id) await held;
      await fulfillJson(route, REFRESH_RESULT);
    });
    await mockJson(page, `${API_URL}/auth/logout`, {});
    await page.route(`${API_URL}/auth/login`, (route) => {
      nextSession = true;
      return fulfillJson(route, {id: '00000000-0000-4000-8000-000000000002', name: 'Next Example', email: 'next@example.test', isEmailVerified: true, createdAt: '2026-01-01T00:00:00Z'});
    });
    await page.goto('/bank-connections');
    await expect.poll(() => requests).toEqual([MOCK_CONNECTION.id]);
    try {
      await homePage.logOut();
      await expect(page).toHaveURL(/\/login$/);
      await loginPage.emailInput.fill('next@example.test');
      await loginPage.passwordInput.fill('synthetic-test-password');
      await loginPage.submitButton.click();
      await expect(page.getByTestId('account-menu-trigger')).toContainText('NE');
      await expect.poll(() => requests).toEqual([MOCK_CONNECTION.id, next.id]);
      await page.getByRole('navigation', {name: 'Primary'}).getByRole('link', {name: 'Connections', exact: true}).click();
      await expect(page.getByTestId(`bank-connection-${next.id}`)).toBeVisible();
    } finally {
      release();
    }
    expect(requests).toEqual([MOCK_CONNECTION.id, next.id]);
  });

  test('cancels hidden foreground work and reads current connection state on reopening', async ({page}) => {
    await page.addInitScript(() => {
      const fetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.endsWith('/refresh')) {
          init?.signal?.addEventListener('abort', () => {
            document.documentElement.dataset.refreshAborted = 'true';
          }, {once: true});
        }
        return fetch(input, init);
      };
    });
    const second = {...MOCK_CONNECTION, id: '00000000-0000-4000-8000-000000000095'};
    const third = {...MOCK_CONNECTION, id: '00000000-0000-4000-8000-000000000094'};
    let reopened = false;
    let listReads = 0;
    const requests: string[] = [];
    await mockBankConnections(page, () => {
      listReads++;
      return reopened ? [
        {...MOCK_CONNECTION, syncStatus: 'RUNNING'},
        {...second, status: 'EXPIRED'},
        third,
      ] : [MOCK_CONNECTION, second];
    });
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/bank-connections/*/refresh', async (route) => {
      const id = new URL(route.request().url()).pathname.split('/')[2];
      requests.push(id);
      if (id === MOCK_CONNECTION.id) await held;
      await fulfillJson(route, REFRESH_RESULT);
    });
    await page.goto('/bank-connections');
    await expect.poll(() => requests).toEqual([MOCK_CONNECTION.id]);
    try {
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', {value: 'hidden', configurable: true});
        window.dispatchEvent(new Event('visibilitychange'));
      });
      await expect(page.locator('html')).toHaveAttribute('data-refresh-aborted', 'true');
      expect(requests).toEqual([MOCK_CONNECTION.id]);
      expect(await page.locator('[data-sonner-toast]').count()).toBe(0);
      expect(await page.getByRole('status').filter({hasText: /^Offline/}).count()).toBe(0);
      reopened = true;
      const readsBefore = listReads;
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', {value: 'visible', configurable: true});
        window.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('visibilitychange'));
      });
      await expect.poll(() => requests).toEqual([MOCK_CONNECTION.id, third.id]);
      expect(listReads).toBeGreaterThan(readsBefore);
    } finally {
      release();
    }
  });

  test('refreshes once per visible opening and retries a failed bank on reopening', async ({page}) => {
    let requests = 0;
    await mockBankConnections(page, [MOCK_CONNECTION]);
    await page.route(`**/bank-connections/${MOCK_CONNECTION.id}/refresh`, (route) => {
      requests++;
      return fulfillJson(
        route,
        requests === 1
          ? {
              ...REFRESH_RESULT,
              status: 'FAILED',
              transactionsAdded: 0,
              errorMessage: 'Example bank is unavailable.',
            }
          : REFRESH_RESULT,
      );
    });
    await page.goto('/bank-connections');
    const card = page.getByTestId(`bank-connection-${MOCK_CONNECTION.id}`);
    await expect(page.getByText('Bank refresh failed', {exact: true})).toBeVisible();
    expect(requests).toBe(1);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('online'));
      window.dispatchEvent(new Event('visibilitychange'));
    });
    await page.getByTestId('account-menu-trigger').click();
    await page.getByRole('menuitem', {name: 'Settings'}).click();
    await page.getByRole('link', {name: 'Connections', exact: true}).click();
    await expect(card).toBeVisible();
    expect(requests).toBe(1);
    await page.evaluate(() => {
      for (const value of ['hidden', 'visible']) {
        Object.defineProperty(document, 'visibilityState', {value, configurable: true});
        window.dispatchEvent(new Event('visibilitychange'));
      }
    });
    await expect.poll(() => requests).toBe(2);
  });

  test('shows a partial refresh with saved balances and the bank error', async ({page}) => {
    let completed = false;
    await mockBankConnections(page, () => [
      {
        ...MOCK_CONNECTION,
        bankAccounts: MOCK_CONNECTION.bankAccounts.map((account) => ({
          ...account,
          currentBalanceAmount: completed ? '1000.00' : account.currentBalanceAmount,
        })),
      },
    ]);
    await page.route(`**/bank-connections/${MOCK_CONNECTION.id}/refresh`, async (route) => {
      completed = true;
      await fulfillJson(route, {
        ...REFRESH_RESULT,
        status: 'PARTIAL',
        transactionsAdded: 1,
        errorMessage: 'Example account is unavailable.',
      });
    });
    await page.goto('/bank-connections');
    const card = page.getByTestId(`bank-connection-${MOCK_CONNECTION.id}`);
    await expect(card.getByTestId('bank-connection-total')).toContainText('2,000.00');
    await expect(page.locator('[data-sonner-toast]')).toContainText(
      'Example account is unavailable.',
    );
    await expect(page.getByText('Bank refresh incomplete', {exact: true})).toBeVisible();
  });

  for (const {width, theme} of [
    {width: 1440, theme: 'light'},
    {width: 390, theme: 'dark'},
    {width: 320, theme: 'light'},
  ]) {
    test(`connects, refreshes on opening, and removes a mock bank account at ${width}px in ${theme}`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(20_000);
      await page.setViewportSize({width, height: 900});
      await page.emulateMedia({reducedMotion: 'reduce'});
      await page.addInitScript((value) => localStorage.setItem('vite-ui-theme', value), theme);
      let connectionPersisted = false;
      let connectionDeleted = false;
      let refreshed = false;
      let refreshRequests = 0;
      let releaseRefresh!: () => void;
      const refreshHeld = new Promise<void>((resolve) => (releaseRefresh = resolve));
      let authorizationRequest: {aspspName: string; aspspCountry: string} | undefined;
      let callbackRequest: URL | undefined;
      let callbackRedirectUrl = '';
      let providerCallbackUrl = '';

      await page.route('https://enablebanking.com/brands/NL/Mock-ASPSP/', (route) =>
        route.fulfill({status: 200, contentType: 'image/png', body: PROVIDER_LOGO_PNG}),
      );
      await page.route(`**/bank-connections/${MOCK_CONNECTION.id}/transactions*`, (route) =>
        fulfillJson(route, {transactions: [], total: 0}),
      );
      await page.route(`**/bank-connections/${MOCK_CONNECTION.id}/refresh`, async (route) => {
        expect(route.request().method()).toBe('POST');
        expect(route.request().postData()).toBeNull();
        refreshRequests++;
        await refreshHeld;
        refreshed = true;
        await fulfillJson(route, REFRESH_RESULT);
      });

      await mockJson(page, '**/bank-connections/aspsps', [
        {
          ...TARGET_ASPSP,
          logoUrl: 'https://enablebanking.com/brands/NL/Mock-ASPSP/',
        },
      ]);

      await routeBankConnectionsApi(page, async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue();
          return;
        }
        await fulfillJson(
          route,
          connectionPersisted && !connectionDeleted
            ? [
                {
                  ...MOCK_CONNECTION,
                  lastSyncedAt: refreshed ? REFRESH_RESULT.finishedAt : null,
                  bankAccounts: MOCK_CONNECTION.bankAccounts.map((account) => ({
                    ...account,
                    currentBalanceAmount: refreshed ? '1000.00' : account.currentBalanceAmount,
                  })),
                },
              ]
            : [],
        );
      });

      await page.route('**/bank-connections/authorize', async (route) => {
        authorizationRequest = route.request().postDataJSON() as {
          aspspName: string;
          aspspCountry: string;
        };
        await fulfillJson(route, {authorizationUrl: `${MOCK_PROVIDER_ORIGIN}/consent`}, 201);
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
      await picker.getByTestId('bank-connection-confirm').click();

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
      await expect(connectionCard.getByText('Consent valid until', {exact: false})).toBeHidden();
      await expectNoHorizontalOverflow(page);
      try {
        await expect.poll(() => refreshRequests).toBe(1);
        await page.screenshot({
          path: testInfo.outputPath(`refresh-pending-${width}-${theme}.png`),
          fullPage: true,
        });
        await connectionCard.getByTestId(/^connection-card-toggle-/).click();
        await expect(
          connectionCard.getByRole('button', {name: 'Remove connection'}),
        ).toBeDisabled();
        expect(refreshRequests).toBe(1);
      } finally {
        releaseRefresh();
      }
      await expect(connectionCard.getByTestId('bank-connection-total')).toContainText('2,000.00');
      await expect(connectionCard.getByRole('button', {name: 'Remove connection'})).toBeEnabled();
      await page.screenshot({
        path: testInfo.outputPath(`refresh-complete-${width}-${theme}.png`),
        fullPage: true,
      });
      await expect(connectionCard.getByRole('heading', {name: 'Accounts'})).toBeVisible();
      await expect(connectionCard.getByText('Mock current account', {exact: true})).toBeVisible();
      await expect(connectionCard.getByText('Consent valid until', {exact: false})).toBeVisible();
      await expect(connectionCard.getByRole('button', {name: 'Remove'})).toBeVisible();
      await connectionCard.getByRole('button', {name: 'Remove'}).click();
      await expect(page.getByRole('heading', {name: 'Remove connected bank?'})).toBeVisible();
      await page.getByTestId(`remove-bank-confirmation-${MOCK_CONNECTION.id}`).fill('DELETE');
      await page.getByTestId(`remove-bank-confirm-${MOCK_CONNECTION.id}`).click();

      await expect(page.getByText('Bank connection removed', {exact: true})).toBeVisible();
      await expect.poll(() => connectionDeleted).toBe(true);
      await expect(connectionCard).toHaveCount(0);
      await expect(page.getByText('0 connections', {exact: true})).toBeVisible();
    });
  }
});

test.describe('manual bank refresh caches', () => {
  test.use({storageState: {cookies: [], origins: []}});

  for (const status of ['SUCCEEDED', 'PARTIAL', 'FAILED'] as const) {
    test(`${status} manual refresh updates saved bank-derived data and reuses fresh supported banks`, async () => {
      const {client, renderHook} = createHookHarness({
        '@/utils/api': {api: {post: () => Promise.resolve({...REFRESH_RESULT, status})}},
        sonner: {toast: {error: () => undefined}},
      });
      const keys = [
        bankQueryKeys.connections,
        bankQueryKeys.transactions(
          {pageIndex: 0, pageSize: 10},
          {cashFlows: ['SPENDING']},
          undefined,
        ),
        bankQueryKeys.transaction('example-transaction'),
        bankQueryKeys.connectionTransactions(MOCK_CONNECTION.id, null),
        dashboardQueryKeys.summary('2026-09', '2026-10-01'),
        dashboardQueryKeys.summary('2026-08', '2026-10-01'),
        dashboardQueryKeys.balanceTrend('month', '2026-01-01', '2026-10-01', '2026-10-01'),
        dashboardQueryKeys.cashFlow('month', '2026-01-01', '2026-10-01', '2026-10-01'),
        dashboardQueryKeys.reviewCounts,
        recurringQueryKeys.lists('2026-10-01'),
        recurringQueryKeys.summary('2026-10-01'),
      ];
      keys.forEach((key) => client.setQueryData(key, {revision: 0}));
      client.setQueryData(bankQueryKeys.supportedBanks, [TARGET_ASPSP]);
      let catalogReads = 0;
      const catalogObserver = new QueryObserver(client, {
        queryKey: bankQueryKeys.supportedBanks,
        staleTime: 60 * 60_000,
        queryFn: () => {
          catalogReads++;
          return Promise.resolve([TARGET_ASPSP]);
        },
      });
      const unsubscribeCatalog = catalogObserver.subscribe(() => {});
      const unrelated = ['example-unrelated'];
      client.setQueryData(unrelated, {revision: 0});
      let reads = 0;
      const observer = new QueryObserver(client, {
        queryKey: dashboardQueryKeys.reviewCounts,
        queryFn: () => Promise.resolve({revision: ++reads}),
      });
      const unsubscribe = observer.subscribe(() => {});
      try {
        const {refreshBankConnection} = renderHook<{
          refreshBankConnection: (request: {connectionId: string}) => Promise<unknown>;
        }>('src/features/banking/api/use-refresh-bank-connection.ts', 'useRefreshBankConnection');
        await refreshBankConnection({connectionId: MOCK_CONNECTION.id});
        expect(catalogReads).toBe(0);
        expect(client.getQueryState(bankQueryKeys.supportedBanks)?.isInvalidated).toBe(false);
        expect(client.getQueryData(dashboardQueryKeys.reviewCounts)).toEqual({revision: 1});
        for (const key of keys.filter((key) => key !== dashboardQueryKeys.reviewCounts))
          expect(client.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true);
        expect(client.getQueryState(unrelated)?.isInvalidated).toBe(false);
      } finally {
        unsubscribeCatalog();
        unsubscribe();
        client.clear();
      }
    });
  }
});

test.describe('bank connection card layout', () => {
  test.use({storageState: VERIFIED_USER_AUTH_FILE});

  test('shows footer actions only while a connection card is expanded', async ({page}) => {
    await page.goto('/bank-connections');

    const card = page.locator('[data-testid^="bank-connection-"][aria-labelledby]').first();
    const toggle = card.getByTestId(/^connection-card-toggle-/);
    const accounts = card.getByTestId(/^bank-accounts-/);
    const transactions = card.getByTestId(/^bank-transactions-/);
    const removeButton = card.getByTestId(/^remove-bank-/);
    const consentText = card.getByText(/Consent valid until/);

    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(accounts).toBeHidden();
    await expect(transactions).toBeHidden();
    await expect(removeButton).toBeHidden();
    await expect(consentText).toBeHidden();

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(accounts).toBeVisible();
    await expect(transactions).toBeVisible();
    await expect(removeButton).toBeVisible();
    await expect(consentText).toBeVisible();

    const [cardBox, , expandedRemoveBox] = await Promise.all([
      boxOf(card),
      boxOf(consentText),
      boxOf(removeButton),
    ]);
    expect(expandedRemoveBox.width).toBe(44);
    expect(expandedRemoveBox.height).toBe(44);
    expect(
      cardBox.x + cardBox.width - (expandedRemoveBox.x + expandedRemoveBox.width),
    ).toBeGreaterThanOrEqual(16);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(accounts).toBeHidden();
    await expect(transactions).toBeHidden();
    await expect(removeButton).toBeHidden();
    await expect(consentText).toBeHidden();
  });
});

test.describe('bank connection loading errors', () => {
  test.use({storageState: VERIFIED_USER_AUTH_FILE});

  test('shows a retryable error when connections cannot load', async ({page}) => {
    let connectionRequests = 0;
    await routeBankConnectionsApi(page, async (route) => {
      connectionRequests += 1;
      await fulfillJson(route, {message: 'Service unavailable'}, 503);
    });

    await page.goto('/bank-connections');

    await expect(page.getByRole('heading', {name: 'Bank connections', exact: true})).toBeVisible();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(
      page.getByRole('heading', {name: 'Could not load bank connections'}),
    ).toBeVisible();
    const retryButton = page.getByTestId('bank-connections-retry');
    await expect(retryButton).toBeVisible();
    const retryButtonBox = await boxOf(retryButton);
    expect(retryButtonBox.height).toBeGreaterThanOrEqual(44);
    expect(connectionRequests).toBe(1);
  });
});

test.describe('bank connections without bank connections', () => {
  test('shows the connect prompt without bank connections', async ({page, freshAccount}) => {
    await page.goto('/bank-connections');
    await expect(page.getByTestId('current-account-email')).toHaveText(freshAccount.email);

    await expect(page.getByRole('heading', {name: 'No bank connections'})).toBeVisible();
    await expect(page.getByRole('button', {name: 'Connect a bank'})).toHaveCount(1);
  });
});
