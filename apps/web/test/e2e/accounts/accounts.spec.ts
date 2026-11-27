import type {Page} from '@playwright/test';
import type {BankConnection, UpdateBankAccountRequest} from '@tempo/contracts';

import {VERIFIED_USER_AUTH_FILE} from '../../constants/auth.constants';
import {SEEDED_TRANSACTION_YEAR_NOW} from '../../constants/seed.constants';
import {MOCK_CONNECTION, REFRESH_RESULT, TARGET_ASPSP} from '../../data/bank-connection.data';
import {bankImport, importedFiles} from '../../data/bank-import.data';
import {createBankTransaction} from '../../data/bank-transaction.data';
import {API_URL, expect, test} from '../../fixtures';
import {mockAccountsApi} from '../../utils/accounts';
import {
  fulfillJson,
  fulfillRedirect,
  mockBankConnections,
  mockBankRefresh,
  mockJson,
  routeBankConnectionsApi,
  transformBankConnections,
} from '../../utils/api-mocks';
import {
  accountRow,
  attentionLines,
  chooseDeleteEverything,
  openAccount,
  openRemoval,
  routeMockedBankApp,
} from '../../utils/bank-connections';
import {connectThroughPicker} from '../../utils/bank-picker';
import {boxOf, expectNoHorizontalOverflow} from '../../utils/layout';

const MOCK_PROVIDER_ORIGIN = 'https://enablebanking.test';
const PROVIDER_LOGO_URL = 'https://enablebanking.com/brands/NL/ABN-AMRO/';
const MONOCHROME_LOGO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 40"><rect x="8" y="8" width="144" height="24" fill="#000"/></svg>';
// A 1x1 PNG served in place of the provider logo, so the test does not depend on the live CDN.
const PROVIDER_LOGO_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const SYNC_IN_PROGRESS_REMOVAL =
  'Bank sync is in progress. Wait for it to finish before removing this connection.';
const CHECKING = MOCK_CONNECTION.bankAccounts[0];

test.describe('accounts', () => {
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

    await page.goto('/accounts');
    await expect(page.getByTestId('accounts-total')).toContainText('1,335.00');
    await expect(attentionLines(page)).toHaveCount(0);
    await expect.poll(() => requestCount, {timeout: 12_000}).toBeGreaterThan(1);
    await expect(attentionLines(page)).toHaveCount(0);
  });

  test('lists seeded accounts by type with the total and how current each is, and opens an account page', async ({
    page,
  }) => {
    await page.clock.setFixedTime(SEEDED_TRANSACTION_YEAR_NOW);
    await mockJson(page, '**/bank-connections/aspsps', [
      {name: 'ABN AMRO', country: 'NL', logoUrl: PROVIDER_LOGO_URL},
    ]);
    await mockJson(page, '**/bank-connections/aspsps/logos/NL/QUJOIEFNUk8', {
      url: PROVIDER_LOGO_URL,
    });
    await page.route(`${PROVIDER_LOGO_URL}*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        headers: {'Access-Control-Allow-Origin': '*'},
        body: MONOCHROME_LOGO_SVG,
      }),
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

    await page.goto('/accounts?result=connected');

    await expect(page.getByRole('heading', {name: 'Accounts', level: 1})).toBeVisible();
    // The toast times out, so check it on landing rather than after the later steps.
    await expect(page.getByText('Bank connection added')).toBeVisible();
    await expect(page).toHaveURL(new RegExp('/accounts$'));
    await expect(page.getByTestId('accounts-total')).toContainText('€123.45');
    const cash = page.getByRole('region', {name: 'Cash'});
    const row = accountRow(page, accountId);
    await expect(cash.getByTestId(`account-row-${accountId}`)).toBeVisible();
    await expect(row.getByRole('link', {name: 'Daily spending'})).toBeVisible();
    await expect(row).toContainText('ABN AMRO · Current account');
    await expect(row).toContainText('live sync');
    await expect(row).toContainText('€123.45');
    // The seeded bank last synced on 26 Aug, more than a day before the fixed clock.
    const freshness = row.getByTestId('account-freshness');
    await expect(freshness).toHaveText('Synced 35 days ago');
    await expect(freshness).toHaveAttribute('data-tone', 'warning');

    const bankLogo = row.getByTestId('account-bank-logo');
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    await expect(bankLogo.locator('img:visible')).toHaveAttribute('src', PROVIDER_LOGO_URL);
    await expect(bankLogo).toHaveCSS('width', '36px');
    await expect(bankLogo).toHaveCSS('height', '36px');
    for (const theme of ['light', 'dark']) {
      await page.evaluate(
        (value) => document.documentElement.classList.toggle('dark', value === 'dark'),
        theme,
      );
      await expect(bankLogo.locator('img')).toHaveAttribute('src', PROVIDER_LOGO_URL);
      await expect(bankLogo).toHaveCSS(
        'background-color',
        theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(238, 240, 245)',
      );
      await expect(bankLogo).toHaveCSS('border-top-width', '1px');
      await expect(bankLogo).toHaveCSS('border-top-color', 'rgb(214, 217, 228)');
    }

    const connection = await openAccount(page, accountId);
    await expect(page.getByRole('heading', {name: 'Daily spending', level: 1})).toBeVisible();
    await expect(page.getByTestId('account-balance')).toContainText('€123.45');
    for (const [label, value] of [
      ['Country', 'Netherlands'],
      ['Accounts', '1'],
      ['Access until', '1 Jan 2030'],
    ]) {
      await expect(connection.getByText(label, {exact: true}).locator('xpath=..')).toContainText(
        value,
      );
    }
    await expect(connection.getByRole('button', {name: 'Remove connection'})).toBeVisible();
    await expect(page.getByTestId('account-about')).toContainText('Live sync');
    const transactions = page.getByRole('region', {name: 'Transactions'});
    await expect(transactions.getByRole('listitem').first()).toBeVisible();

    await transactions.getByRole('link', {name: 'All in Transactions'}).click();
    await expect(page).toHaveURL(/\/transactions\?/);
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

  for (const {syncStatus, label, detail, reconnect} of [
    {
      syncStatus: 'FAILED',
      label: 'Sync failed',
      detail: 'no updates since 1 Jan 2020 · retries on its own',
      reconnect: false,
    },
    {
      syncStatus: 'PARTIAL',
      label: 'Automatic sync is partial',
      detail: 'no updates since 1 Jan 2020 · retries on its own',
      reconnect: false,
    },
    {
      syncStatus: 'RATE_LIMITED',
      label: 'Automatic sync is rate-limited',
      detail: 'no updates since 1 Jan 2020 · retries on its own',
      reconnect: false,
    },
    {
      syncStatus: 'EXPIRED',
      label: 'Access expired',
      detail: 'no updates since 1 Jan 2020',
      reconnect: true,
    },
  ] as const) {
    test(`shows the ${syncStatus} sync problem with the bank's last successful sync`, async ({
      page,
    }) => {
      await mockBankConnections(page, [
        {
          ...MOCK_CONNECTION,
          syncStatus,
          // A partial run moves the last sync on without making the bank up to date.
          lastSyncedAt: new Date(Date.now() - 60_000).toISOString(),
          lastSuccessfulSyncAt: '2020-01-01T12:00:00.000Z',
          createdAt: '2026-01-01T00:00:00.000Z',
          nextSyncAt: '2020-01-02T00:00:00.000Z',
          lastSyncError: 'Synthetic bank refresh failed.',
        },
      ]);

      await page.goto('/accounts');
      // Every account of the bank says so.
      const problems = attentionLines(page);
      await expect(problems).toHaveCount(2);
      await expect(problems.first()).toContainText(`${label} · ${detail}`);
      await expect(page.getByRole('button', {name: 'Reconnect'})).toHaveCount(reconnect ? 2 : 0);
    });
  }

  for (const {syncStatus, since, lastSuccessfulSyncAt, createdAt} of (
    ['FAILED', 'PARTIAL', 'RATE_LIMITED'] as const
  ).flatMap((syncStatus) => [
    {
      syncStatus,
      since: 'the last successful sync',
      lastSuccessfulSyncAt: new Date(Date.now() - 23 * 60 * 60_000).toISOString(),
      createdAt: '2020-01-01T12:00:00.000Z',
    },
    {
      syncStatus,
      since: 'connecting a bank that never fully synced',
      lastSuccessfulSyncAt: null,
      createdAt: new Date(Date.now() - 60 * 60_000).toISOString(),
    },
  ])) {
    test(`keeps a ${syncStatus} sync quiet within a day of ${since}`, async ({page}) => {
      await mockBankConnections(page, [
        {
          ...MOCK_CONNECTION,
          syncStatus,
          lastSyncedAt: new Date(Date.now() - 60_000).toISOString(),
          lastSuccessfulSyncAt,
          createdAt,
          nextSyncAt: new Date(Date.now() + 15 * 60_000).toISOString(),
          lastSyncError: 'Synthetic bank refresh failed.',
        },
      ]);

      await page.goto('/accounts');
      await expect(page.getByTestId('accounts-total')).toContainText('1,335.00');
      await expect(attentionLines(page)).toHaveCount(0);
      await expect(
        page
          .getByRole('navigation', {name: 'Primary'})
          .getByRole('link', {name: 'Accounts', exact: true}),
      ).toBeVisible();
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
            lastSuccessfulSyncAt: new Date(Date.now() - 60 * 60_000).toISOString(),
            nextSyncAt: '2020-01-02T00:00:00.000Z',
          },
        ];
      });

      await page.goto('/accounts');
      await expect(page.getByTestId('accounts-total')).toContainText('1,335.00');
      await expect(attentionLines(page)).toHaveCount(0);
      await expect.poll(() => requestCount, {timeout: 12_000}).toBeGreaterThan(1);
      await expect(attentionLines(page)).toHaveCount(0);
    });
  }

  test('asks to reconnect when consent is missing', async ({page}) => {
    await mockBankConnections(page, [{...MOCK_CONNECTION, consentValidUntil: null}]);

    await page.goto('/accounts');
    await expect(accountRow(page, CHECKING.id).getByTestId('account-freshness')).toContainText(
      'Access expired',
    );
    await expect(
      accountRow(page, CHECKING.id).getByRole('button', {name: 'Reconnect'}),
    ).toBeVisible();
  });

  test('asks to reconnect when persisted consent has expired', async ({page}) => {
    await transformBankConnections(page, (connections) =>
      connections.map((connection) => ({
        ...connection,
        status: 'AUTHORIZED',
        consentValidUntil: '2020-01-01T00:00:00.000Z',
        syncStatus: 'SUCCEEDED',
        nextSyncAt: '2030-01-01T00:00:00.000Z',
      })),
    );

    await page.goto('/accounts');

    await expect(attentionLines(page).first()).toContainText('Access expired');
    await expect(page.getByRole('button', {name: 'Reconnect'}).first()).toBeVisible();
  });

  test('removes a bank connection that holds no account after a rate-limited attempt', async ({
    page,
  }) => {
    const emptyConnectionId = '00000000-0000-4000-8000-000000000098';
    let emptyConnectionVisible = true;
    let rateLimited = true;
    const emptyConnection = {
      id: emptyConnectionId,
      provider: 'enable-banking',
      aspspName: 'ABN AMRO',
      aspspCountry: 'NL',
      status: 'AUTHORIZED',
      consentValidUntil: '2030-01-01T00:00:00.000Z',
      lastSyncedAt: null,
      lastSuccessfulSyncAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      lastSyncError: null,
      nextSyncAt: null,
      syncStatus: 'IDLE',
      bankAccounts: [],
    };

    await transformBankConnections(page, (connections) =>
      emptyConnectionVisible ? [...connections, emptyConnection] : connections,
    );
    await page.route(`**/bank-connections/${emptyConnectionId}`, async (route) => {
      if (route.request().method() !== 'DELETE') {
        await route.continue();
        return;
      }
      if (rateLimited) {
        rateLimited = false;
        await fulfillJson(route, {retryAfterSeconds: 30}, 429);
        return;
      }

      emptyConnectionVisible = false;
      await route.fulfill({status: 204, body: ''});
    });

    await page.goto('/accounts');

    const empty = page.getByTestId(`unlinked-connection-${emptyConnectionId}`);
    await expect(page.getByRole('region', {name: 'Banks without accounts'})).toBeVisible();
    await expect(empty).toContainText('No accounts shared');
    await empty.getByRole('button', {name: 'Remove ABN AMRO'}).click();
    const dialog = page.getByRole('dialog');
    // The connection holds no accounts, so removing it offers no choice.
    await expect(dialog.getByRole('radio')).toHaveCount(0);
    const confirm = dialog.getByRole('button', {name: 'Remove permanently'});
    await confirm.click();

    // The rate limit has its own toast and the removal adds none; the dialog stays for a retry.
    await expect(page.getByText('Rate limit exceeded', {exact: true})).toBeVisible();
    await expect(page.getByText('Unable to remove bank connection', {exact: true})).toHaveCount(0);
    await expect(dialog).toBeVisible();

    await confirm.click();
    await expect(page.getByText('Bank connection removed', {exact: true})).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(empty).toHaveCount(0);
  });

  test('requires explicit confirmation before removing a connected bank connection', async ({
    page,
  }) => {
    await page.setViewportSize({width: 393, height: 852});
    const connectedConnectionId = '00000000-0000-4000-8000-000000000097';
    let connectedConnectionVisible = true;
    let deleteCalled = false;
    let accountId = '';

    await transformBankConnections(page, (connections) => {
      const connectedConnection = {
        ...connections[0],
        id: connectedConnectionId,
        status: 'AUTHORIZED',
        lastSyncedAt: null,
      };
      accountId = connectedConnection.bankAccounts[0].id;
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

    await page.goto('/accounts');
    await expect(page.getByTestId(/^account-row-/).first()).toBeVisible();

    // Dismissed, the removal starts again on keeping the accounts.
    await page.emulateMedia({reducedMotion: 'reduce'});
    let dialog = await openRemoval(page, accountId);
    await chooseDeleteEverything(dialog);
    await dialog.getByRole('button', {name: 'Cancel'}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', {name: 'Remove connection'}).click();
    dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', {name: 'Remove ABN AMRO?'})).toBeVisible();
    await expect(dialog.getByRole('radio', {name: /^Keep accounts and history/})).toBeChecked();
    expect(deleteCalled).toBe(false);

    const confirmButton = page.getByTestId(`remove-bank-confirm-${connectedConnectionId}`);
    await expect(confirmButton).toHaveText('Remove connection');
    await chooseDeleteEverything(dialog);
    await expect(
      dialog.getByText(
        'Permanently deletes the account and its transactions. This cannot be undone.',
      ),
    ).toBeVisible();
    await expect(confirmButton).toHaveText('Remove permanently');
    await expect(confirmButton).toBeEnabled();
    await confirmButton.click();

    await expect(page.getByText('Bank connection removed', {exact: true})).toBeVisible();
    expect(deleteCalled).toBe(true);
    // Its account is gone, so the page goes back to Accounts.
    await expect(page).toHaveURL(/\/accounts$/);
    await expect(page.getByTestId(/^account-row-/)).toHaveCount(0);
  });

  test('returns to the installed app after bank authorization', async ({page, context}) => {
    // Before opening the page: the list loads the supported banks for its logos, and the picker reuses that answer.
    await mockJson(page, '**/bank-connections/aspsps', [
      {
        name: 'Mock ASPSP',
        country: 'NL',
        logoUrl: 'https://enablebanking.com/brands/NL/Mock-ASPSP/',
      },
    ]);
    await page.goto('/accounts');
    const authorizationUrl = 'https://bank.example.test/mock-bank-authorization';
    const callbackUrl = new URL('./accounts?result=connected', page.url()).toString();
    await mockJson(page, '**/bank-connections/authorize', {authorizationUrl}, 201);
    await context.route('**/mock-bank-authorization', async (route) => {
      await fulfillRedirect(route, callbackUrl);
    });

    let popupOpened = false;
    page.on('popup', () => {
      popupOpened = true;
    });

    await connectThroughPicker(page, {name: 'Mock ASPSP', countryLabel: 'Netherlands'});

    await expect(page.getByText('Bank connection added')).toBeVisible();
    await expect(page).toHaveURL(/\/accounts$/);
    expect(popupOpened).toBe(false);
  });

  test('keeps the account list usable at phone widths', async ({page}) => {
    await mockBankRefresh(page);
    await page.setViewportSize({width: 393, height: 852});
    await page.goto('/accounts');

    const heading = page.getByRole('heading', {name: 'Accounts', level: 1});
    const connectButton = page.getByRole('button', {name: 'Connect a bank'}).first();
    const group = page.getByRole('region', {name: 'Cash'});
    const row = group.getByTestId(/^account-row-/).first();

    await expect(heading).toBeVisible();
    await expect(connectButton).toBeVisible();
    await expect(row).toBeVisible();
    const [headingBox, connectButtonBox, groupBox, rowBox] = await Promise.all([
      boxOf(heading),
      boxOf(connectButton),
      boxOf(group),
      boxOf(row),
    ]);
    expect(headingBox.height).toBe(26);
    expect(connectButtonBox.x + connectButtonBox.width).toBeLessThanOrEqual(393 - 16);
    expect(groupBox.x).toBe(16);
    expect(groupBox.x + groupBox.width).toBe(393 - 16);
    expect(rowBox.height).toBeGreaterThanOrEqual(60);
    await expectNoHorizontalOverflow(page);
  });

  test('keeps the account list within a narrow phone viewport', async ({page}) => {
    await page.setViewportSize({width: 320, height: 852});
    await page.goto('/accounts');

    const group = page.getByRole('region', {name: 'Cash'});
    const activeTab = page.getByTestId('app-tab-bar').getByRole('link', {name: 'Accounts'});

    await expect(group.getByRole('link', {name: 'Daily spending'})).toBeVisible();
    await expect(activeTab).toHaveAttribute('aria-current', 'page');

    const [groupBox, activeTabBox] = await Promise.all([boxOf(group), boxOf(activeTab)]);
    expect(groupBox.x + groupBox.width).toBeLessThanOrEqual(320);
    expect(activeTabBox.height).toBeGreaterThanOrEqual(44);
    await expectNoHorizontalOverflow(page);
  });

  test('supports enlarged text without horizontal overflow', async ({page}) => {
    await page.setViewportSize({width: 320, height: 852});
    await page.goto('/accounts');
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
    await routeMockedBankApp(page, baseURL);
  });

  test('totals known balances in their one currency, or else the base currency, without phone overflow', async ({
    page,
  }) => {
    const multiCurrencyConnection: BankConnection = {
      ...MOCK_CONNECTION,
      bankAccounts: [
        ...MOCK_CONNECTION.bankAccounts,
        {
          ...CHECKING,
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
    const currencies = (
      baseCurrency: string | null,
      [first, second]: [string, string],
    ): BankConnection => ({
      ...MOCK_CONNECTION,
      baseCurrency,
      bankAccounts: [
        {...MOCK_CONNECTION.bankAccounts[0], currency: first},
        {...MOCK_CONNECTION.bankAccounts[1], currency: second},
      ],
    });
    let connection = currencies(null, ['EUR', 'EUR']);
    await page.setViewportSize({width: 320, height: 852});
    await mockBankConnections(page, () => [connection]);
    const total = page.getByTestId('accounts-total').locator('.numeric').first();
    const rows = page.getByTestId(/^account-row-/);

    // Balances in one currency add up in that currency, before the owner has a base currency.
    await page.goto('/accounts');
    await expect(total).toHaveText('€1,335.00');
    connection = currencies('EUR', ['USD', 'USD']);
    await page.reload();
    await expect(total).toHaveText('$1,335.00');
    // Mixed currencies add up only in the base currency.
    connection = currencies(null, ['EUR', 'USD']);
    await page.reload();
    await expect(rows).toHaveCount(2);
    await expect(total).toHaveCount(0);

    connection = balances('0.00');
    await page.reload();
    await expect(page.getByText('€0.00', {exact: true})).toHaveCount(3);
    connection.bankAccounts[0].currentBalanceAmount = '-25.00';
    connection.bankAccounts[1].currentBalanceAmount = '25.00';
    await page.reload();
    await expect(rows.first()).toContainText('-€25.00');
    await expect(total).toHaveText('€0.00');
    connection = balances(null);
    await page.reload();
    await expect(rows).toHaveCount(2);
    await expect(total).toHaveCount(0);

    connection = multiCurrencyConnection;
    await page.reload();
    const usdRow = accountRow(page, '00000000-0000-4000-8000-000000000099');
    await expect(usdRow).toContainText('$50.00');
    await expect(usdRow).toContainText('≈ €46.00');
    await expect(total).toHaveText('€1,381.00');
    for (const amount of ['0', '0.00', '-0.00']) {
      connection.bankAccounts[2].currentBalanceAmount = amount;
      connection.bankAccounts[2].currentBalanceInBaseCurrency = '0.00';
      await page.reload();
      await expect(usdRow).toContainText('$0.00');
      await expect(usdRow.getByText(/≈/)).toHaveCount(0);
      await expect(total).toHaveText('€1,335.00');
    }
    // Zero balances need no exchange rate and do not change the total's currency.
    connection.bankAccounts[2].currentBalanceInBaseCurrency = null;
    await page.reload();
    await expect(total).toHaveText('€1,335.00');
    connection.bankAccounts[2].currentBalanceAmount = '-50.00';
    connection.bankAccounts[2].currentBalanceInBaseCurrency = '-46.00';
    await page.reload();
    await expect(usdRow).toContainText('≈ -€46.00');
    await expect(total).toHaveText('€1,289.00');
    connection.bankAccounts[2].currentBalanceAmount = '0.01';
    connection.bankAccounts[2].currentBalanceInBaseCurrency = '0.00';
    await page.reload();
    await expect(usdRow).toContainText('≈ €0.00');
    const [cardBox, totalBox] = await Promise.all([
      boxOf(page.getByTestId('accounts-total')),
      boxOf(total),
    ]);
    expect(totalBox.x + totalBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
    await expectNoHorizontalOverflow(page);
  });

  test('reconnects an expired bank from its row and from its account page', async ({page}) => {
    const expired = {...MOCK_CONNECTION, status: 'EXPIRED' as const};
    let reconnected = false;
    const authorizations: unknown[] = [];
    await mockAccountsApi(page, () => ({connections: [reconnected ? MOCK_CONNECTION : expired]}));
    await page.route('**/bank-connections/authorize', async (route) => {
      authorizations.push(route.request().postDataJSON());
      await fulfillJson(route, {authorizationUrl: `${MOCK_PROVIDER_ORIGIN}/consent`}, 201);
    });
    // The bank sends the owner straight back, as Enable Banking's callback does once it has the consent.
    await page.route(`${MOCK_PROVIDER_ORIGIN}/consent`, async (route) => {
      reconnected = true;
      await fulfillRedirect(route, new URL('/accounts?result=connected', page.url()).toString());
    });
    await page.goto('/accounts');

    const row = accountRow(page, CHECKING.id);
    await expect(row.getByTestId('account-freshness')).toContainText('Access expired');
    await row.getByRole('button', {name: 'Reconnect'}).click();
    await expect(page.getByText('Bank connection added')).toBeVisible();
    await expect(page).toHaveURL(/\/accounts$/);
    expect(authorizations).toEqual([
      {aspspName: TARGET_ASPSP.name, aspspCountry: TARGET_ASPSP.country},
    ]);
    await expect(attentionLines(page)).toHaveCount(0);

    reconnected = false;
    await page.reload();
    const connection = await openAccount(page, CHECKING.id);
    await expect(page.getByTestId('account-freshness')).toContainText('Access expired');
    await connection.getByRole('button', {name: 'Reconnect'}).click();
    await expect(page.getByText('Bank connection added')).toBeVisible();
    await expect(page).toHaveURL(/\/accounts$/);
    expect(authorizations).toHaveLength(2);
  });

  test('removes a connected bank from its account page and keeps its accounts and history as imported files', async ({
    page,
  }) => {
    const imported = importedFiles(MOCK_CONNECTION.bankAccounts);
    let removal: unknown = null;
    await mockAccountsApi(page, () => ({connections: removal ? [imported] : [MOCK_CONNECTION]}));
    await page.route(`**/bank-connections/${MOCK_CONNECTION.id}`, async (route) => {
      if (route.request().method() !== 'DELETE') return route.continue();
      removal = route.request().postDataJSON();
      await route.fulfill({status: 204, body: ''});
    });
    await page.goto('/accounts');

    const dialog = await openRemoval(page, CHECKING.id);
    await expect(dialog.getByRole('radio', {name: /^Keep accounts and history/})).toBeChecked();
    await expect(
      dialog.getByText(
        'Syncing stops. Your 2 accounts and their transactions stay, and you can add statement files.',
      ),
    ).toBeVisible();
    const confirm = dialog.getByRole('button', {name: 'Remove connection', exact: true});
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(page.getByText('Bank connection removed', {exact: true})).toBeVisible();
    expect(removal).toEqual({keepAccounts: true});
    // The account stays, now from statement files, so its page stays open.
    await expect(page).toHaveURL(new RegExp(`/accounts/${CHECKING.id}$`));
    await expect(page.getByTestId('account-about')).toContainText('Statement files');
    await expect(page.getByTestId('account-connection')).toHaveCount(0);
    await page.goto('/accounts');
    await expect(accountRow(page, CHECKING.id)).toContainText('statement files');
  });

  test('renames an account, hides it under Hidden with the total dropping, and shows it again', async ({
    page,
  }) => {
    const savingsId = MOCK_CONNECTION.bankAccounts[1].id;
    const {connections, updates} = await mockAccountSettings(page, [MOCK_CONNECTION]);
    await mockAccountsApi(page, () => ({connections: connections()}));
    await page.goto('/accounts');
    await expect(page.getByTestId('accounts-total')).toContainText('1,335.00');

    await openAccount(page, savingsId);
    const settings = page.getByTestId('account-settings');
    // A synced account goes with its connection, on the connection card.
    await expect(settings.getByRole('button', {name: 'Remove account'})).toHaveCount(0);
    await settings.getByRole('button', {name: 'Rename'}).click();
    const rename = page.getByRole('dialog', {name: 'Rename account'});
    const field = rename.getByRole('textbox', {name: 'Name'});
    await expect(field).toHaveValue('Mock ASPSP savings account');
    await field.fill('  Holiday savings ');
    await rename.getByRole('button', {name: 'Save'}).click();
    await expect(rename).toHaveCount(0);
    await expect(page.getByRole('heading', {level: 1})).toHaveText('Holiday savings');

    await settings.getByRole('button', {name: 'Hide from lists and totals'}).click();
    await expect(page.getByTestId('account-hidden-note')).toHaveText(
      'Hidden: not in your lists or totals',
    );
    await expect(settings.getByRole('button', {name: 'Show in lists and totals'})).toBeVisible();
    expect(updates).toEqual([{alias: 'Holiday savings'}, {isHidden: true}]);

    await page.goto('/accounts');
    await expect(page.getByTestId('accounts-total')).toContainText('1,234.56');
    const hidden = page.getByTestId('accounts-hidden');
    await expect(hidden.getByRole('heading', {name: 'Hidden'})).toBeVisible();
    await expect(hidden.getByTestId(`account-row-${savingsId}`)).toContainText('Holiday savings');
    await expect(
      page.getByTestId('accounts-group-cash').getByTestId(`account-row-${savingsId}`),
    ).toHaveCount(0);

    await hidden.getByRole('button', {name: 'Show Holiday savings'}).click();
    await expect(page.getByTestId('accounts-hidden')).toHaveCount(0);
    await expect(
      page.getByTestId('accounts-group-cash').getByTestId(`account-row-${savingsId}`),
    ).toContainText('Holiday savings');
    await expect(page.getByTestId('accounts-total')).toContainText('1,335.00');
    expect(updates[updates.length - 1]).toEqual({isHidden: false});
  });

  test('removes an imported-files account after a plain confirmation of what goes, or hides it instead', async ({
    page,
  }) => {
    const fileAccount = {
      ...CHECKING,
      id: '00000000-0000-4000-8000-000000000401',
      details: 'Example Card',
    };
    const files = importedFiles([fileAccount]);
    const {connections, updates, removals} = await mockAccountSettings(page, [
      MOCK_CONNECTION,
      files,
    ]);
    await mockAccountsApi(page, () => ({
      connections: connections(),
      // One import only it holds, and one shared with the bank's account, which stays.
      imports: [
        bankImport(fileAccount.id),
        bankImport(fileAccount.id, {
          accounts: [
            {id: fileAccount.id, name: null, currency: 'EUR', created: false},
            {id: CHECKING.id, name: null, currency: 'EUR', created: false},
          ],
        }),
      ],
      transactions: [1, 2, 3].map((day) =>
        createBankTransaction({
          id: `00000000-0000-4000-8000-00000000071${day}`,
          bookingDate: `2026-11-0${day}`,
          bankAccountId: fileAccount.id,
        }),
      ),
    }));
    await page.goto('/accounts');
    await openAccount(page, fileAccount.id);

    const settings = page.getByTestId('account-settings');
    await settings.getByRole('button', {name: 'Remove account'}).click();
    let dialog = page.getByRole('dialog', {name: 'Remove Example Card?'});
    await expect(dialog.getByTestId('remove-account-summary')).toHaveText(
      'The accountExample CardTransactions3Imports1',
    );
    await expect(dialog).toContainText('This cannot be undone.');
    await dialog.getByRole('button', {name: 'Hide it instead'}).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('account-hidden-note')).toBeVisible();
    expect(updates).toEqual([{isHidden: true}]);
    expect(removals).toEqual([]);

    await settings.getByRole('button', {name: 'Remove account'}).click();
    dialog = page.getByRole('dialog', {name: 'Remove Example Card?'});
    await expect(dialog.getByRole('button', {name: 'Hide it instead'})).toBeDisabled();
    await dialog.getByRole('button', {name: 'Remove account'}).click();

    await expect(page.getByText('Example Card removed with its 3 transactions')).toBeVisible();
    expect(removals).toEqual([
      {
        path: `/bank-connections/${files.id}/accounts/${fileAccount.id}`,
        body: {confirmation: 'DELETE'},
      },
    ]);
    await expect(page).toHaveURL(/\/accounts$/);
    await expect(accountRow(page, fileAccount.id)).toHaveCount(0);
    await expect(accountRow(page, CHECKING.id)).toBeVisible();
  });

  test('explains a synchronization conflict that arrives while the removal dialog is open', async ({
    page,
  }) => {
    let running = false;
    await mockAccountsApi(page, () => ({
      connections: [{...MOCK_CONNECTION, syncStatus: running ? 'RUNNING' : 'SUCCEEDED'}],
    }));
    await page.goto('/accounts');
    await chooseDeleteEverything(await openRemoval(page, CHECKING.id));
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
      page.getByRole('dialog').getByText(SYNC_IN_PROGRESS_REMOVAL, {exact: true}),
    ).toBeVisible();
  });

  for (const syncStatus of ['QUEUED', 'RUNNING'] as const) {
    test(`blocks removal and explains why while bank sync is ${syncStatus}`, async ({page}) => {
      let removals = 0;
      await mockAccountsApi(page, () => ({connections: [{...MOCK_CONNECTION, syncStatus}]}));
      await page.route(`**/bank-connections/${MOCK_CONNECTION.id}`, (route) => {
        removals++;
        return route.fulfill({status: 204, body: ''});
      });
      await page.goto('/accounts');
      const dialog = await openRemoval(page, CHECKING.id);
      await expect(dialog.getByRole('status')).toHaveText(SYNC_IN_PROGRESS_REMOVAL);
      await chooseDeleteEverything(dialog);
      const confirm = dialog.getByRole('button', {name: 'Remove permanently'});
      await expect(confirm).toBeDisabled();
      await dialog.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit());
      await expect(dialog).toBeVisible();
      expect(removals).toBe(0);
    });
  }

  test.describe('on a touch phone', () => {
    test.use({hasTouch: true, isMobile: true, viewport: {width: 390, height: 844}});

    test('explains blocked removal in the drawer', async ({page}) => {
      await mockAccountsApi(page, () => ({
        connections: [{...MOCK_CONNECTION, syncStatus: 'RUNNING'}],
      }));
      await page.goto(`/accounts/${CHECKING.id}`);
      await page.getByRole('button', {name: 'Remove connection'}).tap();
      const drawer = page.getByRole('dialog');
      const reason = drawer.getByRole('status');
      await expect(reason).toHaveText(SYNC_IN_PROGRESS_REMOVAL);
      const box = await boxOf(reason);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
      await expect(drawer.getByTestId(`remove-bank-confirm-${MOCK_CONNECTION.id}`)).toBeDisabled();
    });
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
      const logo = {metadataUrl: '/bank-connections/aspsps/logos/NL/mock'};
      await mockJson(page, '**/bank-connections/aspsps/logos/NL/mock', {
        url: '/example-neutral.svg',
      });
      await page.route('**/example-neutral.svg', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'image/svg+xml',
          body: `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="40"><rect width="160" height="40" fill="#000000"/></svg>`,
        }),
      );
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
          logo,
          logoUrl: 'https://enablebanking.com/brands/NL/Mock-ASPSP/',
        },
      ]);

      // The account page's own reads; the connections answer below.
      await mockAccountsApi(page, () => ({connections: []}));
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
                  logo,
                  lastSyncedAt: refreshed ? REFRESH_RESULT.finishedAt : null,
                  lastSuccessfulSyncAt: refreshed ? REFRESH_RESULT.finishedAt : null,
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

      await page.goto('/accounts');
      callbackRedirectUrl = new URL('/accounts?result=connected', page.url()).toString();
      const providerCallback = new URL('/bank-connections/callback', page.url());
      providerCallback.searchParams.set('state', 'mock-authorization-state');
      providerCallback.searchParams.set('code', 'mock-provider-code');
      providerCallbackUrl = providerCallback.toString();
      await expect(page.getByRole('heading', {name: 'No accounts yet'})).toBeVisible();

      await connectThroughPicker(page, {name: TARGET_ASPSP.name, countryLabel: 'Netherlands'});

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
      await expect(page).toHaveURL(/\/accounts$/);
      await expect.poll(() => callbackRequest?.searchParams.get('code')).toBe('mock-provider-code');
      expect(callbackRequest?.searchParams.get('state')).toBe('mock-authorization-state');
      expect(connectionPersisted).toBe(true);

      const row = accountRow(page, CHECKING.id);
      await expect(row).toBeVisible();
      await expect(row).toContainText(`${TARGET_ASPSP.name} · Current account · ••1234`);
      const bankPlate = row.getByTestId('account-bank-logo');
      await expect(bankPlate).toHaveCSS(
        'background-color',
        theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(238, 240, 245)',
      );
      await expect(bankPlate).toHaveCSS('border-top-width', '1px');
      await expect(bankPlate).toHaveCSS('border-top-color', 'rgb(214, 217, 228)');
      const themedImage = bankPlate.locator('img:visible');
      await expect(themedImage).toHaveAttribute('src', /example-neutral\.svg$/);
      await expect(themedImage).toHaveJSProperty('naturalWidth', 160);
      await expect(page.getByTestId(/^account-row-/)).toHaveCount(2);
      await expectNoHorizontalOverflow(page);
      const connection = await openAccount(page, CHECKING.id);
      await expect(
        connection.getByText('Access until', {exact: true}).locator('xpath=..'),
      ).toContainText('1 Jan 2030');
      await connection.getByRole('button', {name: 'Remove connection'}).click();
      const dialog = page.getByRole('dialog');
      await chooseDeleteEverything(dialog);
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
      await expect(page.getByTestId('account-balance')).toContainText('€1,000.00');
      await expect(confirm).toBeEnabled();
      await page.screenshot({
        path: testInfo.outputPath(`refresh-complete-${width}-${theme}.png`),
        fullPage: true,
      });
      await confirm.click();

      await expect(page.getByText('Bank connection removed', {exact: true})).toBeVisible();
      await expect.poll(() => connectionDeleted).toBe(true);
      await expect(page).toHaveURL(/\/accounts$/);
      await expect(page.getByRole('heading', {name: 'No accounts yet'})).toBeVisible();
    });
  }

  test('while the list loads, shows a total and a group placeholder as wide as the loaded cards', async ({
    page,
  }) => {
    await page.setViewportSize({width: 1280, height: 900});
    await mockBankRefresh(page);
    let answer = () => {};
    const answered = new Promise<void>((resolve) => (answer = resolve));
    await page.route(`${API_URL}/bank-connections`, async (route) => {
      await answered;
      await fulfillJson(route, [MOCK_CONNECTION]);
    });
    await page.goto('/accounts');

    const placeholders = page.getByRole('status', {name: 'Loading accounts'}).locator(':scope > *');
    await expect(placeholders).toHaveCount(2);
    const [first, second] = await Promise.all([
      boxOf(placeholders.nth(0)),
      boxOf(placeholders.nth(1)),
    ]);
    expect(second.width).toBe(first.width);

    answer();
    const group = page.getByRole('region', {name: 'Cash'});
    await expect(group).toBeVisible();
    expect((await boxOf(group)).width).toBe(first.width);
    expect((await boxOf(page.getByTestId('accounts-total'))).width).toBe(first.width);
  });

  test('says Tempo is not answering, without mentioning sessions, when the first check fails', async ({
    page,
  }) => {
    await page.route('**/accounts/me', (route) => route.abort('failed'));
    await page.goto('/accounts');

    await expect(page.getByRole('heading', {name: "Can't reach Tempo"})).toBeVisible();
    await expect(page.locator('body')).toContainText(
      "Tempo isn't answering right now. Try again in a moment.",
    );
  });

  test('says an account that is not among the owner’s is not found, with a way back', async ({
    page,
  }) => {
    await mockAccountsApi(page, () => ({connections: [MOCK_CONNECTION]}));
    await page.goto('/accounts/00000000-0000-4000-8000-0000000000ff');
    await expect(page.getByRole('heading', {name: 'Account not found', level: 1})).toBeVisible();
    await page.getByRole('link', {name: 'All accounts'}).click();
    await expect(page).toHaveURL(/\/accounts$/);
    await expect(page.getByTestId(/^account-row-/)).toHaveCount(2);
  });
});

test.describe('account loading errors', () => {
  test.use({storageState: VERIFIED_USER_AUTH_FILE});

  test('shows a retryable error when accounts cannot load', async ({page}) => {
    let connectionRequests = 0;
    let answerRetry = () => {};
    await routeBankConnectionsApi(page, async (route) => {
      connectionRequests += 1;
      if (connectionRequests > 1) await new Promise<void>((resolve) => (answerRetry = resolve));
      await fulfillJson(route, {message: 'Service unavailable'}, 503);
    });

    await page.goto('/accounts');

    await expect(page.getByRole('heading', {name: 'Accounts', exact: true})).toBeVisible();
    const alert = page.getByRole('alert');
    await expect(alert.getByRole('heading', {name: "Couldn't load accounts"})).toBeVisible();
    await expect(alert).toContainText('The server ran into a problem.');
    await expect(alert).toContainText(/503 · \d{2}:\d{2}/);
    expect(connectionRequests).toBe(1);

    // Try again loads the list again until the server answers, then the error returns.
    await alert.getByRole('button', {name: 'Try again'}).click();
    await expect(page.getByRole('status', {name: 'Loading accounts'})).toBeVisible();
    await expect.poll(() => connectionRequests).toBe(2);
    answerRetry();
    await expect(alert.getByRole('button', {name: 'Try again'})).toBeEnabled();
    await expect(alert).toContainText(/503 · \d{2}:\d{2}/);
  });

  test('loads accounts once when Tempo answers after an unanswered first session check', async ({
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

    await page.goto('/accounts');
    await expect(page.getByRole('heading', {name: "Can't reach Tempo"})).toBeVisible();
    // Focus makes Tempo check its connection now instead of on its next timer.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));

    await expect(page.getByRole('heading', {name: "Couldn't load accounts"})).toBeVisible();
    expect(connectionRequests).toBe(1);
  });
});

test.describe('accounts without any', () => {
  test('shows the ways to add data without accounts', async ({page, freshAccount}) => {
    await page.goto('/accounts');
    await expect(page.getByTestId('current-account-email')).toHaveText(freshAccount.email);

    await expect(page.getByRole('heading', {name: 'No accounts yet'})).toBeVisible();
    await expect(page.getByRole('button', {name: 'Connect a bank'}).first()).toBeVisible();
  });
});

/**
 * Answers an account's rename, hide and removal against the given connections, as the API keeps them: each PATCH body
 * and each DELETE is recorded, and `connections` reads the current state.
 */
async function mockAccountSettings(page: Page, initial: BankConnection[]) {
  let state = initial;
  const updates: unknown[] = [];
  const removals: {path: string; body: unknown}[] = [];
  await page.route(
    (url) =>
      url.origin === API_URL && /^\/bank-connections\/[^/]+\/accounts\/[^/]+$/.test(url.pathname),
    async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const accountId = path.slice(path.lastIndexOf('/') + 1);
      if (request.method() === 'DELETE') {
        removals.push({path, body: request.postDataJSON()});
        state = state.map((connection) => ({
          ...connection,
          bankAccounts: connection.bankAccounts.filter(({id}) => id !== accountId),
        }));
        return route.fulfill({status: 204, body: ''});
      }
      const body = request.postDataJSON() as UpdateBankAccountRequest;
      updates.push(body);
      state = state.map((connection) => ({
        ...connection,
        bankAccounts: connection.bankAccounts.map((account) =>
          account.id === accountId
            ? {
                ...account,
                ...(body.alias !== undefined && {alias: body.alias?.trim() || null}),
                ...(body.isHidden !== undefined && {isHidden: body.isHidden}),
              }
            : account,
        ),
      }));
      const account = state
        .flatMap(({bankAccounts}) => bankAccounts)
        .find(({id}) => id === accountId);
      return fulfillJson(route, account);
    },
  );
  return {connections: () => state, updates, removals};
}
