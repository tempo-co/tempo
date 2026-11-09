import type {BankConnection} from '@tempo/contracts';

import {VERIFIED_USER_AUTH_FILE} from '../../constants/auth.constants';
import {SEEDED_TRANSACTION_YEAR_NOW} from '../../constants/seed.constants';
import {MOCK_CONNECTION, REFRESH_RESULT, TARGET_ASPSP} from '../../data/bank-connection.data';
import {expect, test} from '../../fixtures';
import {
  fulfillJson,
  fulfillRedirect,
  mockBankConnections,
  mockBankRefresh,
  mockJson,
  routeBankConnectionsApi,
  transformBankConnections,
} from '../../utils/api-mocks';
import {openDetails, openRemoval, routeMockedBankApp} from '../../utils/bank-connections';
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
    // A single-colour logo, readable by the logo analysis (CORS), so the dark theme inverts it.
    await page.route(PROVIDER_LOGO_URL, (route) =>
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
    await expect(bankLogo).toHaveAttribute('data-logo-analysis', 'monochrome');
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    await expect(bankLogo.locator('img')).toHaveCSS('filter', 'none');
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await expect(bankLogo.locator('img')).toHaveCSS('filter', 'brightness(0) invert(1)');

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
    // The dialog keeps showing the bank on every frame of its closing animation.
    await details.evaluate((dialog) => {
      const titles: string[] = [];
      (window as unknown as {closingTitles: string[]}).closingTitles = titles;
      const sample = () => {
        if (!dialog.isConnected) return;
        if (dialog.getAttribute('data-state') === 'closed') {
          const title = document.getElementById(dialog.getAttribute('aria-labelledby') ?? '');
          titles.push(title?.textContent ?? '');
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.keyboard.press('Escape');
    await expect(details).toBeHidden();
    const closingTitles = await page.evaluate(
      () => (window as unknown as {closingTitles: string[]}).closingTitles,
    );
    expect(new Set(closingTitles)).toEqual(new Set(['ABN AMRO']));
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

  test('returns to the installed app after bank authorization', async ({page, context}) => {
    // Before opening the page: the list loads the supported banks for its logos, and the picker reuses that answer.
    await mockJson(page, '**/bank-connections/aspsps', [
      {
        name: 'Mock ASPSP',
        country: 'NL',
        logoUrl: 'https://enablebanking.com/brands/NL/Mock-ASPSP/',
      },
    ]);
    await page.goto('/bank-connections');
    const authorizationUrl = 'https://bank.example.test/mock-bank-authorization';
    const callbackUrl = new URL('./bank-connections?result=connected', page.url()).toString();
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
    const connectionCard = page.getByTestId(`bank-connection-${MOCK_CONNECTION.id}`);
    const totalBalance = connectionCard.getByTestId('bank-connection-total');

    // Balances in one currency add up in that currency, before the owner has a base currency.
    await page.goto('/bank-connections');
    await expect(totalBalance).toHaveText('Total€1,335.00');
    connection = currencies('EUR', ['USD', 'USD']);
    await page.reload();
    await expect(totalBalance).toHaveText('Total$1,335.00');
    // Mixed currencies add up only in the base currency.
    connection = currencies(null, ['EUR', 'USD']);
    await page.reload();
    await expect(connectionCard.getByRole('link', {name: / transactions$/})).toHaveCount(2);
    await expect(totalBalance).toHaveCount(0);

    // Known zero balances add up to zero; a bank with no balances yet has no total to show.
    connection = balances('0.00');
    await page.reload();
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
