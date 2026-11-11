import type {BankConnection} from '@tempo/contracts';

import {VERIFIED_USER_AUTH_FILE} from '../../constants/auth.constants';
import {SEEDED_TRANSACTION_YEAR_NOW} from '../../constants/seed.constants';
import {HOME_CONNECTION, HOME_NOW, mockSyntheticHome} from '../../data/home-history.data';
import {expect, test} from '../../fixtures';
import {mockBankConnections, mockJson, routeBankConnectionsApi} from '../../utils/api-mocks';
import {expectLoaded, expectNoHorizontalOverflow} from '../../utils/layout';

test.describe('Home without banks', () => {
  test('prompts to connect a bank', async ({page, homePage, freshAccount}) => {
    await page.goto('/');
    await expect(homePage.accountEmail).toHaveText(freshAccount.email);

    await expect(homePage.emptyStateTitle).toBeVisible();
    await expect(page.getByRole('main')).toContainText(
      'where your money went once at least one account has synced.',
    );
    await homePage.connectBankLink.click();
    await expect(page).toHaveURL(/\/bank-connections$/);
  });
});

test.describe('Home', () => {
  test.afterEach(async ({page}) => {
    await page.unrouteAll({behavior: 'wait'});
  });
  test.use({storageState: VERIFIED_USER_AUTH_FILE});

  test.beforeEach(async ({page}) => {
    await page.clock.setFixedTime(SEEDED_TRANSACTION_YEAR_NOW);
  });

  test('shows where the seeded owner stands, and requests it while the connections load', async ({
    page,
    homePage,
  }) => {
    let releaseConnections = () => {};
    const connectionsHeld = new Promise<void>((resolve) => (releaseConnections = resolve));
    await routeBankConnectionsApi(page, async (route) => {
      await connectionsHeld;
      await route.continue();
    });
    const historyRequests = [
      '**/bank-transactions/balance-trend?**',
      '**/bank-transactions/cash-flow?**',
      '**/bank-transactions/breakdown?**',
      '**/bank-transactions/review-counts',
    ].map((url) => page.waitForRequest(url));

    try {
      await page.goto('/');
      await Promise.all(historyRequests);
    } finally {
      releaseConnections();
    }

    await expect(homePage.totalBalance).toHaveText(/^€[\d,]+$/);
    await expect(homePage.yearTable.getByRole('button', {name: /^2026/})).toBeVisible();
    await expect(page.getByRole('region', {name: 'Spending by category'})).toBeVisible();
    await expectLoaded(page.getByRole('main'));
  });

  test('ignores connections that never finished authorizing', async ({page, homePage}) => {
    await mockBankConnections(page, [
      {
        id: '00000000-0000-4000-8000-0000000000aa',
        provider: 'enable-banking',
        aspspName: 'Sample Bank',
        aspspCountry: 'NL',
        status: 'PENDING_AUTHORIZATION',
        consentValidUntil: null,
        lastSyncedAt: null,
        lastSuccessfulSyncAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        lastSyncError: null,
        nextSyncAt: null,
        syncStatus: 'IDLE',
        baseCurrency: null,
        bankAccounts: [],
      },
    ]);
    await page.goto('/');

    await expect(homePage.emptyStateTitle).toBeVisible();
  });
});

test.describe('Home navigation badges', () => {
  test.use({storageState: {cookies: [], origins: []}, timezoneId: 'Europe/Amsterdam'});

  test('Transactions counts what needs review and Connections flags a bank to reconnect', async ({
    page,
    homePage,
  }) => {
    const expired: BankConnection = {
      ...HOME_CONNECTION,
      id: '00000000-0000-4000-8000-0000000000c2',
      aspspName: 'Sample Bank',
      status: 'EXPIRED',
      syncStatus: 'EXPIRED',
    };
    await mockSyntheticHome(page, {connections: [HOME_CONNECTION, expired]});
    await page.goto('/');

    const primary = page.getByRole('navigation', {name: 'Primary'}).first();
    // Two to review, one failed and one without a direction that is also to review, each counted once; the five
    // still categorizing are not counted.
    const transactions = primary.getByRole('link', {name: 'Transactions, 3 to review'});
    await expect(transactions).toHaveText('Transactions3');
    await expect(
      primary.getByRole('link', {name: 'Connections, a bank needs attention'}),
    ).toBeVisible();
    // A retained expired bank still counts towards the totals.
    await expect(homePage.totalBalance).toHaveText('€24,300');

    await transactions.click();
    await expect(page).toHaveURL(/\/bank-transactions/);
  });

  /** An authorized bank whose consent ends `days` after now. */
  const consentEndingIn = (id: string, days: number): BankConnection => ({
    ...HOME_CONNECTION,
    id,
    consentValidUntil: new Date(HOME_NOW.getTime() + days * 24 * 60 * 60 * 1000).toISOString(),
  });
  const expired: BankConnection = {
    ...HOME_CONNECTION,
    id: '00000000-0000-4000-8000-0000000000c9',
    status: 'EXPIRED',
    syncStatus: 'EXPIRED',
  };

  test('Connections flags a bank whose consent ends within a week, and its card offers re-authorizing', async ({
    page,
  }) => {
    await mockSyntheticHome(page, {
      connections: [consentEndingIn('00000000-0000-4000-8000-0000000000c3', 3)],
    });
    await mockJson(page, '**/bank-connections/aspsps', []);
    await page.goto('/');
    const connections = page
      .getByRole('navigation', {name: 'Primary'})
      .first()
      .getByRole('link', {name: 'Connections, a bank needs re-authorizing soon'});
    await expect(connections).toBeVisible();

    await connections.click();
    await expect(page).toHaveURL(/\/bank-connections$/);
    const notice = page.getByTestId('bank-connection-problem');
    await expect(notice).toContainText('Consent ends in 3 days');
    await expect(notice).toContainText('Re-authorize to keep syncing');
    await expect(notice.getByRole('button', {name: 'Re-authorize'})).toBeVisible();
  });

  test('a bank with a sync problem whose consent ends soon leads with re-authorizing', async ({
    page,
  }) => {
    await mockSyntheticHome(page, {
      connections: [
        {...consentEndingIn('00000000-0000-4000-8000-0000000000ca', 3), syncStatus: 'RATE_LIMITED'},
      ],
    });
    await mockJson(page, '**/bank-connections/aspsps', []);
    await page.goto('/bank-connections');
    const notice = page.getByTestId('bank-connection-problem');
    await expect(notice).toHaveCount(1);
    await expect(notice).toContainText('Consent ends in 3 days');
    await expect(notice.getByRole('button', {name: 'Re-authorize'})).toBeVisible();
  });

  for (const {name, connections, label} of [
    {
      name: 'consent ending in 10 days carries no badge',
      connections: [consentEndingIn('00000000-0000-4000-8000-0000000000c4', 10)],
      label: 'Connections',
    },
    {
      name: 'several banks ending soon read as a count',
      connections: [
        consentEndingIn('00000000-0000-4000-8000-0000000000c5', 1),
        consentEndingIn('00000000-0000-4000-8000-0000000000c6', 6),
      ],
      label: 'Connections, 2 banks need re-authorizing soon',
    },
    {
      name: 'a bank with a sync problem whose consent also ends soon is named for both',
      connections: [
        {
          ...consentEndingIn('00000000-0000-4000-8000-0000000000c8', 3),
          syncStatus: 'RATE_LIMITED' as const,
          lastSuccessfulSyncAt: '2026-11-03T11:00:00.000Z',
        },
      ],
      label: 'Connections, a bank needs attention and a bank needs re-authorizing soon',
    },
    {
      name: 'a broken bank and one ending soon are named together',
      connections: [expired, consentEndingIn('00000000-0000-4000-8000-0000000000c7', 3)],
      label: 'Connections, a bank needs attention and a bank needs re-authorizing soon',
    },
  ]) {
    test(`Connections badge: ${name}`, async ({page}) => {
      await mockSyntheticHome(page, {connections});
      await page.goto('/');
      const link = page
        .getByRole('navigation', {name: 'Primary'})
        .first()
        .getByRole('link', {name: label, exact: true});
      await expect(link).toBeVisible();
      await expect(link.locator('i')).toHaveCount(label === 'Connections' ? 0 : 1);
    });
  }

  test('without anything to review or reconnect, the tabs carry no badge', async ({page}) => {
    await mockSyntheticHome(page, {
      reviewCounts: {
        needsReview: 0,
        categorizationFailed: 0,
        categorizing: 4,
        unknownDirection: 0,
        missingBaseAmount: 2,
        needsAttention: 0,
      },
    });
    await page.goto('/');
    const primary = page.getByRole('navigation', {name: 'Primary'}).first();
    await expect(page.getByRole('region', {name: 'Where you stand'})).toBeVisible();
    await expect(primary.getByRole('link', {name: 'Transactions', exact: true})).toHaveText(
      'Transactions',
    );
    await expect(primary.getByRole('link', {name: 'Connections', exact: true})).toBeVisible();
  });

  test('the phone tab bar carries the same badges', async ({page}) => {
    await page.setViewportSize({width: 390, height: 844});
    await mockSyntheticHome(page, {
      connections: [{...HOME_CONNECTION, status: 'EXPIRED', syncStatus: 'EXPIRED'}],
    });
    await page.goto('/');
    const tabs = page.getByRole('navigation', {name: 'Primary'}).last();
    await expect(tabs.getByRole('link', {name: 'Transactions, 3 to review'})).toBeVisible();
    await expect(
      tabs.getByRole('link', {name: 'Connections, a bank needs attention'}),
    ).toBeVisible();
  });
});

test.describe('Home on a phone', () => {
  test.use({
    storageState: {cookies: [], origins: []},
    timezoneId: 'Europe/Amsterdam',
    viewport: {width: 390, height: 844},
  });

  test('fits the screen', async ({page, homePage}) => {
    await mockSyntheticHome(page);
    await page.goto('/');
    await expect(homePage.totalBalance).toHaveText('€24,300');
    await expect(page.getByRole('region', {name: 'Income by source'})).toBeVisible();
    await expectLoaded(page.getByRole('main'));
    await expectNoHorizontalOverflow(page);
  });
});
