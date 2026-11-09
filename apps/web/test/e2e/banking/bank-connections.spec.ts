import type {Locator, Page} from '@playwright/test';
import {type QueryClient, QueryObserver} from '@tanstack/react-query';
import type {BankConnection} from '@tempo/contracts';

import {dashboardQueryKeys} from '../../../src/features/banking/api/aggregate-query-keys';
import {bankQueryKeys} from '../../../src/features/banking/api/query-keys';
import {recurringQueryKeys} from '../../../src/features/banking/api/recurring-query-keys';
import type {BankSyncRun} from '../../../src/features/banking/types/bank-sync-run';
import {VERIFIED_USER_AUTH_FILE} from '../../constants/auth.constants';
import {SEEDED_TRANSACTION_YEAR_NOW} from '../../constants/seed.constants';
import {successfulBankRefresh} from '../../data/bank-sync-run.data';
import {mockHistoryEndpoints} from '../../data/home-history.data';
import {API_URL, expect, test} from '../../fixtures';
import {
  EMPTY_REVIEW_COUNTS,
  fulfillJson,
  fulfillRedirect,
  mockBankConnections,
  mockBankRefresh,
  mockEmptyRecurringLists,
  mockJson,
  mockMerchantRanking,
  routeBankConnectionsApi,
  transformBankConnections,
} from '../../utils/api-mocks';
import {createHookHarness} from '../../utils/hook-harness';
import {boxOf, expectNoHorizontalOverflow} from '../../utils/layout';

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
  baseCurrency: 'EUR',
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
      currentBalanceInBaseCurrency: null,
      baseCurrencyRateDate: null,
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
      currentBalanceInBaseCurrency: null,
      baseCurrencyRateDate: null,
      isActive: true,
      latestBalances: [],
    },
  ],
};

const REFRESH_RESULT = {...successfulBankRefresh, transactionsAdded: 3} satisfies BankSyncRun;
const SYNC_IN_PROGRESS_REMOVAL =
  'Bank sync is in progress. Wait for it to finish before removing this connection.';

/** Opens a bank's details dialog from its card. */
async function openDetails(page: Page, card: Locator) {
  await card.getByRole('button', {name: / details$/}).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Opens a bank's details and switches the dialog to its removal step. */
async function openRemoval(page: Page, card: Locator) {
  const dialog = await openDetails(page, card);
  await dialog.getByRole('button', {name: 'Remove connection'}).click();
  await expect(dialog.getByTestId(/^remove-bank-confirm-/)).toBeVisible();
  return dialog;
}

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
    await expect(page.getByTestId('bank-connection-problem')).toHaveCount(0);
    await expect.poll(() => requestCount, {timeout: 12_000}).toBeGreaterThan(1);
    await expect(page.getByTestId('bank-connection-problem')).toHaveCount(0);
  });

  test('shows seeded connection data, callback feedback and provider logo, and opens an account in Transactions', async ({
    page,
  }) => {
    await page.clock.setFixedTime(SEEDED_TRANSACTION_YEAR_NOW);
    await mockJson(page, '**/bank-connections/aspsps', [
      {name: 'ABN AMRO', country: 'NL', logoUrl: PROVIDER_LOGO_URL},
    ]);
    await page.route(PROVIDER_LOGO_URL, (route) =>
      route.fulfill({status: 200, contentType: 'image/png', body: PROVIDER_LOGO_PNG}),
    );

    let accountId = '';
    await transformBankConnections(page, (connections) => {
      const seededConnection = connections.find(
        (connection) => connection.aspspName === 'ABN AMRO',
      );
      if (!seededConnection) throw new Error('Expected a seeded ABN AMRO connection');
      accountId = seededConnection.bankAccounts[0].id;
      return [seededConnection];
    });

    await page.goto('/bank-connections?result=connected');

    await expect(page.getByRole('heading', {name: 'Bank connections'})).toBeVisible();
    // The toast times out, so check it on landing rather than after the later steps.
    await expect(page.getByText('Bank connection added')).toBeVisible();
    await expect(page).toHaveURL(new RegExp('/bank-connections$'));
    const connectionCard = page.getByRole('region', {name: 'ABN AMRO'});
    await expect(connectionCard).toBeVisible();
    // The seeded bank last updated more than a day before the fixed clock.
    const updated = connectionCard.getByText(/^Updated \d+ days ago$/);
    await expect(updated).toBeVisible();
    await expect(updated).toHaveClass(/text-warning/);
    await expect(connectionCard.getByTestId('bank-connection-problem')).toHaveCount(0);

    const bankLogo = connectionCard.getByTestId('bank-connection-logo');
    await expect(bankLogo.locator('img')).toHaveAttribute('src', PROVIDER_LOGO_URL);
    await expect(bankLogo).toHaveCSS('width', '36px');
    await expect(bankLogo).toHaveCSS('height', '36px');

    const accountRow = connectionCard.getByRole('link', {name: 'Daily spending transactions'});
    await expect(accountRow).toContainText('Daily spending');
    await expect(accountRow).toContainText('Current account');
    await expect(accountRow).toContainText('€123.45');

    const details = await openDetails(page, connectionCard);
    await expect(details.getByRole('heading', {name: 'ABN AMRO'})).toBeVisible();
    for (const [label, value] of [
      ['Country', 'Netherlands'],
      ['Accounts', '1'],
      ['Consent until', '1 Jan 2030'],
    ]) {
      await expect(details.getByText(label, {exact: true}).locator('xpath=..')).toContainText(
        value,
      );
    }
    await expect(details.getByRole('button', {name: 'Remove connection'})).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(details).toBeHidden();
    await expect(connectionCard.getByRole('button', {name: 'ABN AMRO details'})).toBeFocused();

    await accountRow.click();
    await expect(page).toHaveURL(/\/bank-transactions\?/);
    expect(new URL(page.url()).searchParams.get('bankAccountIds')).toBe(
      JSON.stringify([accountId]),
    );
    await expect(
      page
        .getByTestId(/^bank-transaction-row-/)
        .filter({hasText: 'Provider purchase'})
        .first(),
    ).toBeVisible();
  });

  for (const {syncStatus, title, detail} of [
    {
      syncStatus: 'FAILED',
      title: 'Sync failed',
      detail: 'No updates since 1 Jan · retries on its own',
    },
    {
      syncStatus: 'PARTIAL',
      title: 'Automatic sync is partial',
      detail: 'No updates since 1 Jan · retries on its own',
    },
    {
      syncStatus: 'RATE_LIMITED',
      title: 'Automatic sync is rate-limited',
      detail: 'No updates since 1 Jan · retries on its own',
    },
    {syncStatus: 'EXPIRED', title: 'Consent expired', detail: 'No updates since 1 Jan'},
  ] as const) {
    test(`shows the ${syncStatus} sync problem with the bank's last update`, async ({page}) => {
      await mockBankConnections(page, [
        {
          ...MOCK_CONNECTION,
          syncStatus,
          lastSyncedAt: '2020-01-01T12:00:00.000Z',
          nextSyncAt: '2020-01-02T00:00:00.000Z',
          lastSyncError: 'Synthetic bank refresh failed.',
        },
      ]);

      await page.goto('/bank-connections');
      const problem = page.getByTestId('bank-connection-problem');
      await expect(problem).toBeVisible();
      await expect(problem).toHaveAttribute('role', 'alert');
      await expect(problem).toContainText(title);
      await expect(problem).toContainText(detail);
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
      await expect(page.getByTestId('bank-connection-problem')).toHaveCount(0);
      await expect.poll(() => requestCount, {timeout: 12_000}).toBeGreaterThan(1);
      await expect(page.getByTestId('bank-connection-problem')).toHaveCount(0);
    });
  }

  test('requires re-authorization when consent is missing', async ({page}) => {
    await mockBankConnections(page, [{...MOCK_CONNECTION, consentValidUntil: null}]);

    await page.goto('/bank-connections');
    await expect(page.getByRole('button', {name: 'Re-authorize'})).toBeVisible();
    await expect(page.getByTestId('bank-connection-problem')).toContainText('Consent expired');
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

    const problem = page.getByTestId('bank-connection-problem').first();
    await expect(problem).toContainText('Consent expired');
    await expect(page.getByRole('button', {name: 'Re-authorize'})).toBeVisible();
  });

  test('shows an incomplete authorization as not connected and offers re-authorizing', async ({
    page,
  }) => {
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

    const problem = page.getByTestId('bank-connection-problem').first();
    await expect(problem).toContainText('Not connected');
    await expect(problem).toContainText('The bank did not finish authorizing');
    await expect(problem.getByRole('button', {name: 'Re-authorize'})).toBeVisible();
  });

  test('removes an incomplete bank connection after a rate-limited attempt', async ({page}) => {
    const pendingConnectionId = '00000000-0000-4000-8000-000000000098';
    let pendingConnectionVisible = true;
    let rateLimited = true;
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
      if (rateLimited) {
        rateLimited = false;
        await fulfillJson(route, {retryAfterSeconds: 30}, 429);
        return;
      }

      pendingConnectionVisible = false;
      await route.fulfill({status: 204, body: ''});
    });

    await page.goto('/bank-connections');

    const pendingCard = page.getByTestId(`bank-connection-${pendingConnectionId}`);
    await expect(pendingCard).toBeVisible();
    const dialog = await openRemoval(page, pendingCard);
    // An incomplete connection holds no accounts, so removing it needs no typed confirmation.
    await expect(dialog.getByLabel('Type DELETE to confirm')).toHaveCount(0);
    const confirm = dialog.getByRole('button', {name: 'Remove permanently'});
    await confirm.click();

    // The rate limit has its own toast and the removal adds none; the dialog stays for a retry.
    await expect(page.getByText('Rate limit exceeded', {exact: true})).toBeVisible();
    await expect(page.getByText('Unable to remove bank connection', {exact: true})).toHaveCount(0);
    await expect(pendingCard).toBeVisible();

    await confirm.click();
    await expect(page.getByText('Bank connection removed', {exact: true})).toBeVisible();
    await expect(dialog).toBeHidden();
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
    // Dismissed from its removal step, the dialog reopens on the bank's details.
    await page.emulateMedia({reducedMotion: 'reduce'});
    await openRemoval(page, connectedCard);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const reopened = await openDetails(page, connectedCard);
    expect(await reopened.getByTestId(/^remove-bank-confirm-/).count()).toBe(0);
    await expect(reopened.getByRole('button', {name: 'Remove connection'})).toBeVisible();
    await page.keyboard.press('Escape');

    const dialog = await openRemoval(page, connectedCard);
    await expect(dialog.getByRole('heading', {name: 'Remove ABN AMRO?'})).toBeVisible();
    await expect(dialog.getByText(/its 1 account and all their transactions/)).toBeVisible();
    // Back returns to the bank's details in the same dialog.
    await dialog.getByRole('button', {name: 'Back'}).click();
    await expect(dialog.getByRole('heading', {name: 'ABN AMRO'})).toBeVisible();
    await dialog.getByRole('button', {name: 'Remove connection'}).click();
    const backButton = dialog.getByRole('button', {name: 'Back'});
    expect(
      await backButton.evaluate(
        (element) => getComputedStyle(element.parentElement!).paddingBottom,
      ),
    ).toBe('16px');
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
      await fulfillRedirect(route, callbackUrl);
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
    const connectButton = page.getByRole('button', {name: 'Connect a bank'}).first();
    const connectionCard = page.getByRole('region', {name: 'ABN AMRO'});
    const accountRow = connectionCard.getByRole('link', {name: 'Daily spending transactions'});

    await expect(heading).toBeVisible();
    await expect(connectButton).toBeVisible();
    await expect(accountRow).toBeVisible();
    const [headingBox, connectButtonBox, cardBox, rowBox] = await Promise.all([
      boxOf(heading),
      boxOf(connectButton),
      boxOf(connectionCard),
      boxOf(accountRow),
    ]);
    expect(headingBox.height).toBe(32);
    expect(connectButtonBox.x + connectButtonBox.width).toBeLessThanOrEqual(393 - 16);
    expect(cardBox.x).toBe(16);
    expect(cardBox.x + cardBox.width).toBe(393 - 16);
    expect(rowBox.height).toBe(60);
    await expectNoHorizontalOverflow(page);
  });

  test('totals known balances in the base currency without phone overflow', async ({page}) => {
    const multiCurrencyConnection: BankConnection = {
      ...MOCK_CONNECTION,
      bankAccounts: [
        ...MOCK_CONNECTION.bankAccounts,
        {
          ...MOCK_CONNECTION.bankAccounts[0],
          id: '00000000-0000-4000-8000-000000000099',
          details: 'Mock USD account',
          currency: 'USD',
          currentBalanceAmount: '50.00',
          currentBalanceInBaseCurrency: '46.00',
          maskedIdentifier: '****9012',
        },
      ],
    };
    const balances = (amount: string | null): BankConnection => ({
      ...MOCK_CONNECTION,
      bankAccounts: MOCK_CONNECTION.bankAccounts.map((account) => ({
        ...account,
        currentBalanceAmount: amount,
        latestBalances: [],
      })),
    });
    let connection = multiCurrencyConnection;
    await page.setViewportSize({width: 320, height: 852});
    await mockBankConnections(page, () => [connection]);
    const connectionCard = page.getByTestId(`bank-connection-${MOCK_CONNECTION.id}`);
    const totalBalance = connectionCard.getByTestId('bank-connection-total');

    // Known zero balances add up to zero; a bank with no balances yet has no total to show.
    connection = balances('0.00');
    await page.goto('/bank-connections');
    await expect(totalBalance).toHaveText('Total€0.00');
    connection = balances(null);
    await page.reload();
    await expect(connectionCard.getByText('2 accounts', {exact: true})).toBeVisible();
    await expect(totalBalance).toHaveCount(0);

    connection = multiCurrencyConnection;
    await page.reload();
    await expect(connectionCard.getByText('3 accounts', {exact: true})).toBeVisible();
    const usdRow = connectionCard.getByRole('link', {name: 'Mock USD account transactions'});
    await expect(usdRow).toContainText('$50.00');
    await expect(usdRow).toContainText('≈ €46.00');
    await expect(totalBalance).toHaveText('Total€1,381.00');
    const [cardBox, totalBox] = await Promise.all([boxOf(connectionCard), boxOf(totalBalance)]);
    expect(totalBox.x + totalBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
    await expectNoHorizontalOverflow(page);
  });

  test('keeps the connection overview within a narrow phone viewport', async ({page}) => {
    await page.setViewportSize({width: 320, height: 852});
    await page.goto('/bank-connections');

    const connectionCard = page
      .locator('[data-testid^="bank-connection-"][aria-labelledby]')
      .first();
    const activeTab = page.getByTestId('app-tab-bar').getByRole('link', {name: 'Connections'});

    await expect(connectionCard).toBeVisible();
    await expect(
      connectionCard.getByRole('link', {name: 'Daily spending transactions'}),
    ).toBeVisible();
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
    await openRemoval(page, card);
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
      page
        .getByRole('dialog')
        .getByText(
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

  test('reports a lost refresh response once and never replays it on reconnect', async ({page}) => {
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

  test('handles pending and completed connection removal during foreground refresh', async ({
    page,
  }) => {
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
    let releaseSecondRemoval!: () => void;
    const secondRemovalHeld = new Promise<void>((resolve) => (releaseSecondRemoval = resolve));
    await page.emulateMedia({reducedMotion: 'reduce'});
    await mockBankConnections(page, () => {
      reads++;
      return [...(includeFirst ? [first] : []), ...(removed ? [] : [MOCK_CONNECTION])];
    });
    await page.route('**/bank-connections/*/refresh', async (route) => {
      const id = new URL(route.request().url()).pathname.split('/')[2];
      requests.push(id);
      if (id === first.id) await refreshHeld;
      await fulfillJson(
        route,
        removed && id === MOCK_CONNECTION.id ? {message: 'Not found'} : REFRESH_RESULT,
        removed && id === MOCK_CONNECTION.id ? 404 : 200,
      );
    });
    await page.route(`**/bank-connections/${MOCK_CONNECTION.id}`, async (route) => {
      expect(route.request().method()).toBe('DELETE');
      removalAttempts++;
      if (removalAttempts === 1) {
        await held;
        await fulfillJson(route, {message: 'Unavailable'}, 503);
      } else {
        await secondRemovalHeld;
        removed = true;
        await route.fulfill({status: 204, body: ''});
      }
    });
    await page.goto('/bank-connections');
    const card = page.getByTestId(`bank-connection-${MOCK_CONNECTION.id}`);
    await expect.poll(() => requests).toEqual([MOCK_CONNECTION.id]);
    let dialog = await openRemoval(page, card);
    await page.getByTestId(`remove-bank-confirmation-${MOCK_CONNECTION.id}`).fill('DELETE');
    await dialog.getByRole('button', {name: 'Remove permanently', exact: true}).click();
    try {
      await expect(dialog.getByRole('button', {name: 'Removing...'})).toBeDisabled();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      const before = reads;
      await page.evaluate(() => {
        for (const value of ['hidden', 'visible']) {
          Object.defineProperty(document, 'visibilityState', {value, configurable: true});
          window.dispatchEvent(new Event('visibilitychange'));
        }
      });
      await expect.poll(() => reads).toBeGreaterThan(before);
      // Reopened while the removal is still running, the dialog shows it rather than a second one.
      dialog = await openRemoval(page, card);
      await expect(dialog.getByRole('button', {name: 'Removing...'})).toBeDisabled();
      expect(requests).toEqual([MOCK_CONNECTION.id]);
      await page.keyboard.press('Escape');
    } finally {
      releaseRemoval();
    }
    expect(removalAttempts).toBe(1);

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
      dialog = await openRemoval(page, card);
      await page.getByTestId(`remove-bank-confirmation-${MOCK_CONNECTION.id}`).fill('DELETE');
      await dialog.getByRole('button', {name: 'Remove permanently', exact: true}).click();
      await expect(dialog.getByRole('button', {name: 'Removing...'})).toBeDisabled();
      // Another bank opened meanwhile stays open when this removal completes.
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      const firstDetails = await openDetails(page, firstCard);
      releaseSecondRemoval();
      await expect(page.getByText('Bank connection removed', {exact: true})).toBeVisible();
      await expect(card).toHaveCount(0);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await expect(firstDetails).toHaveAttribute('data-state', 'open');
      await page.keyboard.press('Escape');
      // A settled refresh re-reads the saved connections.
      readsBeforeSettle = reads;
    } finally {
      releaseSecondRemoval();
      releaseRefresh();
    }
    await expect.poll(() => reads).toBeGreaterThan(readsBeforeSettle);
    await expect(firstCard).toBeVisible();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
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
        const url =
          typeof args[0] === 'string'
            ? args[0]
            : args[0] instanceof URL
              ? args[0].href
              : args[0].url;
        if (url.endsWith('/refresh'))
          args[1]?.signal?.addEventListener(
            'abort',
            () => {
              document.documentElement.dataset.refreshAborted = 'true';
            },
            {once: true},
          );
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
    test(`blocks removal and explains why while bank sync is ${syncStatus}`, async ({page}) => {
      let removals = 0;
      await mockBankConnections(page, [{...MOCK_CONNECTION, syncStatus}]);
      await page.route(`**/bank-connections/${MOCK_CONNECTION.id}`, (route) => {
        removals++;
        return route.fulfill({status: 204, body: ''});
      });
      await page.goto('/bank-connections');
      const card = page.getByTestId(`bank-connection-${MOCK_CONNECTION.id}`);
      const dialog = await openRemoval(page, card);
      await expect(dialog.getByRole('status')).toHaveText(SYNC_IN_PROGRESS_REMOVAL);
      await page.getByTestId(`remove-bank-confirmation-${MOCK_CONNECTION.id}`).fill('DELETE');
      const confirm = dialog.getByRole('button', {name: 'Remove permanently'});
      await expect(confirm).toBeDisabled();
      await page.getByTestId(`remove-bank-confirmation-${MOCK_CONNECTION.id}`).press('Enter');
      await expect(dialog).toBeVisible();
      expect(removals).toBe(0);
    });
  }

  test.describe('on a touch phone', () => {
    test.use({hasTouch: true, isMobile: true, viewport: {width: 390, height: 844}});

    test('explains blocked removal in the drawer', async ({page}) => {
      await mockBankConnections(page, [{...MOCK_CONNECTION, syncStatus: 'RUNNING'}]);
      await page.goto('/bank-connections');
      const card = page.getByTestId(`bank-connection-${MOCK_CONNECTION.id}`);
      await card.getByRole('button', {name: / details$/}).tap();
      const drawer = page.getByRole('dialog');
      await drawer.getByRole('button', {name: 'Remove connection'}).tap();
      const reason = drawer.getByRole('status');
      await expect(reason).toHaveText(SYNC_IN_PROGRESS_REMOVAL);
      const box = await boxOf(reason);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
      await expect(drawer.getByRole('button', {name: 'Remove permanently'})).toBeDisabled();
    });
  });

  test('opens saved bank data offline without replaying refresh work on reconnect', async ({
    page,
  }) => {
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
    await expect
      .poll(() => page.evaluate(() => !!localStorage.getItem('tempo-offline-cache')))
      .toBe(true);
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
      await expect(card.getByTestId('bank-connection-problem')).toContainText('Consent expired');
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

  test('refreshes the next signed-in account without dispatching the previous account tail', async ({
    page,
    homePage,
    loginPage,
  }) => {
    const next = {...MOCK_CONNECTION, id: '00000000-0000-4000-8000-000000000093'};
    const tail = {...MOCK_CONNECTION, id: '00000000-0000-4000-8000-000000000092'};
    let nextSession = false;
    const requests: string[] = [];
    await mockBankConnections(page, () => (nextSession ? [next] : [MOCK_CONNECTION, tail]));
    await mockHistoryEndpoints(page);
    await mockEmptyRecurringLists(page);
    await mockMerchantRanking(page);
    await mockJson(page, '**/recurring-series/summary?**', {
      expenseMonthlyTotal: '0.00',
      incomeMonthlyTotal: '0.00',
      expenseThisMonth: {month: '2026-10', paid: '0.00', remaining: '0.00'},
      incomeThisMonth: {month: '2026-10', paid: '0.00', remaining: '0.00'},
      upcoming: [],
      flagged: [],
      expenseUnconvertedCount: 0,
      incomeUnconvertedCount: 0,
      baseCurrency: 'EUR',
    });
    await mockJson(page, '**/bank-transactions/review-counts', EMPTY_REVIEW_COUNTS);
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
      return fulfillJson(route, {
        id: '00000000-0000-4000-8000-000000000002',
        name: 'Next Example',
        email: 'next@example.test',
        isEmailVerified: true,
        createdAt: '2026-01-01T00:00:00Z',
      });
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
      await page
        .getByRole('navigation', {name: 'Primary'})
        .getByRole('link', {name: 'Connections', exact: true})
        .click();
      await expect(page.getByTestId(`bank-connection-${next.id}`)).toBeVisible();
    } finally {
      release();
    }
    expect(requests).toEqual([MOCK_CONNECTION.id, next.id]);
  });

  for (const [name, status, advances] of [
    ['succeeded', 'SUCCEEDED', true],
    ['failed', 'FAILED', false],
  ] as const) {
    test(`reloads Home once after ${name} refreshes of every connection on opening`, async ({
      page,
    }) => {
      const second = {...MOCK_CONNECTION, id: '00000000-0000-4000-8000-000000000097'};
      // A succeeded refresh moves its connection's last sync forward; a failed one leaves it.
      const synced = new Set<string>();
      let listReads = 0;
      await mockBankConnections(page, () => {
        listReads++;
        return [MOCK_CONNECTION, second].map((connection) => ({
          ...connection,
          lastSyncedAt: synced.has(connection.id)
            ? '2026-10-02T00:00:00.000Z'
            : '2026-10-01T00:00:00.000Z',
        }));
      });
      await mockHistoryEndpoints(page);
      await mockEmptyRecurringLists(page);
      await mockMerchantRanking(page);
      await mockJson(page, '**/recurring-series/summary?**', {
        expenseMonthlyTotal: '0.00',
        incomeMonthlyTotal: '0.00',
        expenseThisMonth: {month: '2026-10', paid: '0.00', remaining: '0.00'},
        incomeThisMonth: {month: '2026-10', paid: '0.00', remaining: '0.00'},
        upcoming: [],
        flagged: [],
        expenseUnconvertedCount: 0,
        incomeUnconvertedCount: 0,
        baseCurrency: 'EUR',
      });
      await mockJson(page, '**/bank-transactions?**', {transactions: [], total: 0});
      let reviewCountReads = 0;
      await page.route('**/bank-transactions/review-counts', (route) => {
        reviewCountReads++;
        return fulfillJson(route, EMPTY_REVIEW_COUNTS);
      });
      const requests: string[] = [];
      const releases = new Map<string, () => void>();
      const held = new Map(
        [MOCK_CONNECTION.id, second.id].map((id) => [
          id,
          new Promise<void>((resolve) => releases.set(id, resolve)),
        ]),
      );
      await page.route('**/bank-connections/*/refresh', async (route) => {
        const id = new URL(route.request().url()).pathname.split('/')[2];
        requests.push(id);
        await held.get(id);
        if (advances) synced.add(id);
        await fulfillJson(route, {...REFRESH_RESULT, status});
      });
      await page.goto('/');
      let readsBeforeRun = 0;
      try {
        await expect.poll(() => requests).toEqual([MOCK_CONNECTION.id]);
        await expect.poll(() => reviewCountReads).toBe(1);
        readsBeforeRun = listReads;
        releases.get(MOCK_CONNECTION.id)!();
        // The next bank starts only after the previous refresh has settled.
        await expect.poll(() => requests).toEqual([MOCK_CONNECTION.id, second.id]);
        expect(reviewCountReads).toBe(1);
        expect(listReads).toBe(readsBeforeRun);
      } finally {
        releases.forEach((release) => release());
      }
      await expect.poll(() => reviewCountReads).toBe(2);
      expect(listReads).toBe(readsBeforeRun + 1);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      expect(reviewCountReads).toBe(2);
    });
  }

  test('cancels hidden foreground work and reads current connection state on reopening', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const fetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.endsWith('/refresh')) {
          init?.signal?.addEventListener(
            'abort',
            () => {
              document.documentElement.dataset.refreshAborted = 'true';
            },
            {once: true},
          );
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
      return reopened
        ? [{...MOCK_CONNECTION, syncStatus: 'RUNNING'}, {...second, status: 'EXPIRED'}, third]
        : [MOCK_CONNECTION, second];
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
      expect(
        await page
          .getByRole('status')
          .filter({hasText: /^Offline/})
          .count(),
      ).toBe(0);
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

  test('refreshes once per visible opening and retries a failed bank on reopening', async ({
    page,
  }) => {
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

  test('stays silent when the API skips a bank that synchronized moments ago', async ({page}) => {
    let requests = 0;
    let reads = 0;
    let readsAtSkip = Number.POSITIVE_INFINITY;
    await mockBankConnections(page, () => {
      reads++;
      return [MOCK_CONNECTION];
    });
    await page.route(`**/bank-connections/${MOCK_CONNECTION.id}/refresh`, (route) => {
      requests++;
      readsAtSkip = reads;
      return route.fulfill({status: 204, body: ''});
    });
    await page.goto('/bank-connections');
    const card = page.getByTestId(`bank-connection-${MOCK_CONNECTION.id}`);
    await expect.poll(() => requests).toBe(1);
    // The settled refresh re-reads the saved connections; by then any toast would have shown.
    await expect.poll(() => reads).toBeGreaterThan(readsAtSkip);
    await expect(card.getByTestId('bank-connection-total')).toBeVisible();
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
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
        await fulfillRedirect(route, callbackRedirectUrl);
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
      await expect(page.getByRole('heading', {name: 'No bank connections'})).toBeVisible();

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
      await expect(connectionCard).toBeVisible();
      await expect(connectionCard.getByRole('heading', {name: TARGET_ASPSP.name})).toBeVisible();
      await expect(connectionCard.getByText('2 accounts', {exact: true})).toBeVisible();
      await expect(
        connectionCard.getByRole('link', {name: 'Mock ASPSP checking account transactions'}),
      ).toContainText('Current account · ••1234');
      await expectNoHorizontalOverflow(page);
      const dialog = await openDetails(page, connectionCard);
      await expect(
        dialog.getByText('Consent until', {exact: true}).locator('xpath=..'),
      ).toContainText('1 Jan 2030');
      await dialog.getByRole('button', {name: 'Remove connection'}).click();
      await page.getByTestId(`remove-bank-confirmation-${MOCK_CONNECTION.id}`).fill('DELETE');
      const confirm = page.getByTestId(`remove-bank-confirm-${MOCK_CONNECTION.id}`);
      try {
        await expect.poll(() => refreshRequests).toBe(1);
        await page.screenshot({
          path: testInfo.outputPath(`refresh-pending-${width}-${theme}.png`),
          fullPage: true,
        });
        // The opening refresh holds removal back until it settles.
        await expect(dialog.getByRole('status')).toHaveText(SYNC_IN_PROGRESS_REMOVAL);
        await expect(confirm).toBeDisabled();
        expect(refreshRequests).toBe(1);
      } finally {
        releaseRefresh();
      }
      await expect(connectionCard.getByTestId('bank-connection-total')).toContainText('2,000.00');
      await expect(confirm).toBeEnabled();
      await page.screenshot({
        path: testInfo.outputPath(`refresh-complete-${width}-${theme}.png`),
        fullPage: true,
      });
      await confirm.click();

      await expect(page.getByText('Bank connection removed', {exact: true})).toBeVisible();
      await expect.poll(() => connectionDeleted).toBe(true);
      await expect(connectionCard).toHaveCount(0);
      await expect(page.getByRole('heading', {name: 'No bank connections'})).toBeVisible();
    });
  }

  test.describe('card layout', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const account = MOCK_CONNECTION.bankAccounts[0];
    /** Realistic worst cases: long and short names, every problem, huge and foreign amounts. */
    const worstCase = (): BankConnection[] => [
      {
        ...MOCK_CONNECTION,
        id: '00000000-0000-4000-8000-0000000000a4',
        aspspName: 'Example Bank 🏦',
        lastSyncedAt: new Date(Date.now() - 3 * DAY).toISOString(),
        bankAccounts: [
          {
            ...account,
            id: '00000000-0000-4000-8000-0000000000b6',
            currency: 'JPY',
            currentBalanceAmount: '123456789012',
            currentBalanceInBaseCurrency: null,
          },
        ],
      },
      {
        ...MOCK_CONNECTION,
        id: '00000000-0000-4000-8000-0000000000a1',
        aspspName: 'Coöperatieve Voorbeeldbank Noord-Holland Zuid en Omstreken Particulieren',
        consentValidUntil: new Date(Date.now() + 3 * DAY).toISOString(),
        lastSyncedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
        bankAccounts: [
          {
            ...account,
            id: '00000000-0000-4000-8000-0000000000b1',
            alias: 'Gezamenlijke huishoudrekening voor vaste lasten, boodschappen en vakanties',
            currentBalanceAmount: '-1234567890.12',
          },
          {
            ...account,
            id: '00000000-0000-4000-8000-0000000000b2',
            details: 'Spaarrekening',
            cashAccountType: 'SVGS',
            currency: 'CHF',
            currentBalanceAmount: '98765432.10',
            currentBalanceInBaseCurrency: '105432109.87',
            maskedIdentifier: 'NL91ABNA0417164300',
          },
          {
            ...account,
            id: '00000000-0000-4000-8000-0000000000b3',
            details: null,
            name: 'NL91ABNA0417164300NL91ABNA0417164300GB82WEST12345698765432',
            cashAccountType: 'CARD',
            maskedIdentifier: null,
            currentBalanceAmount: '0',
          },
          {
            ...account,
            id: '00000000-0000-4000-8000-0000000000b4',
            details: null,
            name: null,
            cashAccountType: 'TRAS',
            currentBalanceAmount: null,
            latestBalances: [],
          },
        ],
      },
      {
        ...MOCK_CONNECTION,
        id: '00000000-0000-4000-8000-0000000000a2',
        aspspName: 'Jo',
        syncStatus: 'FAILED',
        lastSyncedAt: '2020-01-01T12:00:00.000Z',
        nextSyncAt: '2020-01-02T00:00:00.000Z',
        lastSyncError: 'Synthetic bank refresh failed.',
        bankAccounts: [{...account, id: '00000000-0000-4000-8000-0000000000b5', alias: 'J'}],
      },
      {
        ...MOCK_CONNECTION,
        id: '00000000-0000-4000-8000-0000000000a3',
        aspspName: 'Банк Пример',
        status: 'PENDING_AUTHORIZATION',
        consentValidUntil: null,
        lastSyncedAt: null,
        nextSyncAt: null,
        syncStatus: 'IDLE',
        bankAccounts: [],
      },
    ];

    for (const width of [1440, 390, 320]) {
      test(`keeps 60px account rows and every amount whole at ${width}px, with demo and worst-case data`, async ({
        page,
      }) => {
        await page.setViewportSize({width, height: 900});
        await mockBankRefresh(page);
        let connections: BankConnection[] = [MOCK_CONNECTION];
        await mockBankConnections(page, () => connections);

        for (const data of ['demo', 'worst case'] as const) {
          connections = data === 'demo' ? [MOCK_CONNECTION] : worstCase();
          await page.goto('/bank-connections');
          const cards = page.locator('[data-testid^="bank-connection-"][role="region"]');
          await expect(cards).toHaveCount(connections.length);
          const rows = page.getByRole('link', {name: / transactions$/});
          await expect(rows).toHaveCount(
            connections.reduce((count, connection) => count + connection.bankAccounts.length, 0),
          );

          for (const row of await rows.all()) {
            const [rowBox, tileBox] = await Promise.all([
              boxOf(row),
              boxOf(row.locator(':scope > span').first()),
            ]);
            expect(rowBox.height, data).toBe(60);
            expect(tileBox, data).toMatchObject({width: 36, height: 36});
            // Amounts are never cut short: each fits its own box.
            for (const amount of await row.locator('.numeric').all())
              expect(await amount.evaluate((el) => el.scrollWidth <= el.clientWidth), data).toBe(
                true,
              );
          }

          const cardBoxes = await Promise.all((await cards.all()).map((card) => boxOf(card)));
          for (const box of cardBoxes) expect(box.x + box.width, data).toBeLessThanOrEqual(width);
          for (const card of await cards.all()) {
            const [cardBox, detailsBox] = await Promise.all([
              boxOf(card),
              boxOf(card.getByRole('button', {name: / details$/})),
            ]);
            expect(detailsBox.x + detailsBox.width, data).toBeLessThanOrEqual(
              cardBox.x + cardBox.width,
            );
            const heading = card.getByRole('heading', {level: 2});
            expect(await heading.evaluate((el) => el.scrollWidth <= el.clientWidth), data).toBe(
              true,
            );
          }
          // Wide screens flow cards into two columns; phones keep one.
          const columns = new Set(cardBoxes.map((box) => Math.round(box.x))).size;
          expect(columns, data).toBe(width === 1440 && cardBoxes.length > 1 ? 2 : 1);
          await expectNoHorizontalOverflow(page);
        }

        // Banks that need something come first, in the API's order, each with one problem row.
        const order = await page
          .locator('[data-testid^="bank-connection-"][role="region"]')
          .evaluateAll((cards) => cards.map((card) => card.getAttribute('data-testid')!.slice(-2)));
        expect(order).toEqual(['a1', 'a2', 'a3', 'a4']);
        const problems = page.getByTestId('bank-connection-problem');
        await expect(problems).toHaveCount(3);
        await expect(problems.nth(0)).toContainText('Consent ends in 3 days');
        await expect(problems.nth(1)).toContainText('Sync failed');
        await expect(problems.nth(2)).toContainText('Not connected');
        await expect(page.getByText(/^Updated 3 days ago$/)).toBeVisible();
        const worstTotal = page
          .getByTestId('bank-connection-00000000-0000-4000-8000-0000000000a1')
          .getByTestId('bank-connection-total');
        await expect(worstTotal).toContainText('-€1,129,135,780.25');
      });
    }
  });
});

test.describe('bank-derived caches', () => {
  test.use({storageState: {cookies: [], origins: []}});

  test('bank-derived invalidation updates every bank-derived cache and reuses fresh supported banks', async () => {
    const {client, load} = createHookHarness({});
    const keys = [
      bankQueryKeys.transactions(
        {pageIndex: 0, pageSize: 10},
        {cashFlows: ['SPENDING']},
        undefined,
      ),
      bankQueryKeys.transaction('example-transaction'),
      dashboardQueryKeys.breakdown('year', 'category', '2007-01-01', '2026-10-01', '2026-10-01'),
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
      const {invalidateBankDerivedData} = load(
        'src/features/banking/api/invalidate-bank-derived-data.ts',
      ) as {invalidateBankDerivedData: (client: QueryClient) => Promise<unknown>};
      await invalidateBankDerivedData(client);
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

  test('loads connections once when Tempo answers after an unanswered first session check', async ({
    page,
  }) => {
    let connectionRequests = 0;
    await routeBankConnectionsApi(page, async (route) => {
      connectionRequests += 1;
      await fulfillJson(route, {message: 'Service unavailable'}, 503);
    });
    let sessionChecks = 0;
    await page.route('**/accounts/me', (route) =>
      sessionChecks++ === 0 ? route.abort('failed') : route.continue(),
    );

    await page.goto('/bank-connections');
    await expect(page.getByRole('heading', {name: 'Cannot reach Tempo'})).toBeVisible();
    // Focus makes Tempo check its connection now instead of on its next timer.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));

    await expect(
      page.getByRole('heading', {name: 'Could not load bank connections'}),
    ).toBeVisible();
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
