import type {BankConnection} from '@tempo/contracts';

import {VERIFIED_USER_AUTH_FILE} from '../../constants/auth.constants';
import {SEEDED_TRANSACTION_YEAR_NOW} from '../../constants/seed.constants';
import {HOME_CONNECTION, mockSyntheticHome} from '../../data/home-history.data';
import {expect, test} from '../../fixtures';
import {mockBankConnections, routeBankConnectionsApi} from '../../utils/api-mocks';
import {expectNoHorizontalOverflow} from '../../utils/layout';

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
    // Two to review, one failed and one without a direction; the five still categorizing are not counted.
    const transactions = primary.getByRole('link', {name: 'Transactions, 4 to review'});
    await expect(transactions).toHaveText('Transactions4');
    await expect(
      primary.getByRole('link', {name: 'Connections, a bank needs attention'}),
    ).toBeVisible();
    // A retained expired bank still counts towards the totals.
    await expect(page.getByRole('region', {name: 'Where you stand'})).toBeVisible();

    await transactions.click();
    await expect(page).toHaveURL(/\/bank-transactions/);
  });

  test('without anything to review or reconnect, the tabs carry no badge', async ({page}) => {
    await mockSyntheticHome(page, {
      reviewCounts: {
        needsReview: 0,
        categorizationFailed: 0,
        categorizing: 4,
        unknownDirection: 0,
        missingBaseAmount: 2,
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
    await expect(tabs.getByRole('link', {name: 'Transactions, 4 to review'})).toBeVisible();
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
    await expectNoHorizontalOverflow(page);
  });
});
