import type {BankConnection} from '@tempo/contracts';

import {VERIFIED_USER_AUTH_FILE} from '../../constants/auth.constants';
import {SEEDED_TRANSACTION_YEAR_NOW} from '../../constants/seed.constants';
import {septemberSpending} from '../../data/home-summary.data';
import {expect, test} from '../../fixtures';
import {
  mockBankConnections,
  mockJson,
  routeBankConnectionsApi,
  transformBankConnections,
} from '../../utils/api-mocks';
import {expectNoHorizontalOverflow} from '../../utils/layout';

test.describe('Home without banks', () => {
  test('prompts to connect a bank', async ({page, homePage, freshAccount}) => {
    await page.goto('/');
    await expect(homePage.accountEmail).toHaveText(freshAccount.email);

    await expect(homePage.emptyStateTitle).toBeVisible();
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

  test('moves between months and back to the current one', async ({page, homePage}) => {
    await page.goto('/');

    await expect(homePage.monthHeading).toHaveText('October 2026');
    await expect(homePage.nextMonthButton).toBeDisabled();
    await expect(homePage.backToThisMonthLink).toBeHidden();

    await homePage.previousMonthLink.click();
    await expect(page).toHaveURL(/\?month=2026-09$/);
    await expect(homePage.monthHeading).toHaveText('September 2026');

    await homePage.previousMonthLink.click();
    await expect(page).toHaveURL(/\?month=2026-08$/);
    await homePage.nextMonthLink.click();
    await expect(page).toHaveURL(/\?month=2026-09$/);

    await homePage.nextMonthLink.click();
    await expect(page).toHaveURL(/\/$/);
    await expect(homePage.monthHeading).toHaveText('October 2026');

    await page.goto('/?month=2026-08');
    await homePage.backToThisMonthLink.click();
    await expect(page).toHaveURL(/\/$/);
    await expect(homePage.monthHeading).toHaveText('October 2026');
  });

  test('requests its cards while the bank connections are loading', async ({page, homePage}) => {
    let releaseConnections = () => {};
    const connectionsHeld = new Promise<void>((resolve) => (releaseConnections = resolve));
    await routeBankConnectionsApi(page, async (route) => {
      await connectionsHeld;
      await route.continue();
    });
    const cardRequests = [
      '**/bank-transactions/summary**',
      '**/bank-transactions/cash-flow**',
      '**/bank-transactions/review-counts',
    ].map((url) => page.waitForRequest(url));

    try {
      await page.goto('/');
      await Promise.all(cardRequests);
    } finally {
      releaseConnections();
    }

    await expect(homePage.syncStatus).toBeVisible();
    await expect(page.getByRole('region', {name: 'Balances'})).toBeVisible();
  });

  test("does not show the old month's rows under the month being loaded", async ({page}) => {
    await page.goto('/?month=2026-08');
    await expect(
      page
        .getByRole('region', {name: 'Latest in August 2026'})
        .getByRole('link', {name: /Coffee shop/}),
    ).toBeVisible();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/bank-transactions?**', async (route) => {
      if (
        new URL(route.request().url()).searchParams.get('filter[bookingDate][from]') ===
        '2026-07-01'
      ) {
        await gate;
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({transactions: [], total: 0}),
        });
      } else await route.continue();
    });
    try {
      const request = page.waitForRequest(
        (request) =>
          new URL(request.url()).searchParams.get('filter[bookingDate][from]') === '2026-07-01',
      );
      await page.getByRole('link', {name: 'Previous month'}).click();
      await request;
      await expect(
        page
          .getByRole('region', {name: 'Latest in July 2026'})
          .getByRole('link', {name: /Coffee shop/}),
      ).toHaveCount(0);
    } finally {
      release();
      await page.unrouteAll({behavior: 'wait'});
    }
  });

  test('shows the current month for a future or invalid month', async ({page, homePage}) => {
    await page.goto('/?month=2027-01');
    await expect(homePage.monthHeading).toHaveText('October 2026');
    await expect(homePage.nextMonthButton).toBeDisabled();

    await page.goto('/?month=2026-13');
    await expect(homePage.monthHeading).toHaveText('October 2026');

    await page.goto('/?month=0000-01');
    await expect(homePage.monthHeading).toHaveText('October 2026');
  });

  test('says when the seeded bank last synced', async ({homePage, page}) => {
    await page.goto('/');
    await expect(homePage.syncStatus).toHaveText('Your bank synced about 1 month ago');
  });

  test('leaves out the all-synced line on a phone', async ({homePage, page}) => {
    await page.setViewportSize({width: 390, height: 844});
    await page.goto('/');
    await expect(homePage.monthHeading).toBeVisible();
    await expect(homePage.syncStatus).toBeHidden();
  });

  test('warns about consent that ends within a week', async ({page, homePage}) => {
    await transformBankConnections(page, (connections: BankConnection[]) =>
      connections.map((connection) => ({
        ...connection,
        consentValidUntil: '2026-10-05T10:00:00.000Z',
      })),
    );
    await page.goto('/');

    const warning = homePage.syncStatus.getByRole('link', {
      name: 'ABN AMRO consent expires in 4 days',
    });
    await expect(warning).toBeVisible();
    await warning.click();
    await expect(page).toHaveURL(/\/bank-connections$/);
  });

  test('flags a bank whose consent ended', async ({page, homePage}) => {
    await transformBankConnections(page, (connections: BankConnection[]) =>
      connections.map((connection) => ({
        ...connection,
        status: 'EXPIRED',
        syncStatus: 'EXPIRED',
      })),
    );
    await page.goto('/');

    await expect(homePage.syncStatus).toContainText('ABN AMRO has not synced since 26 Aug');
    await expect(homePage.syncStatus).toContainText('Totals may be missing recent activity.');
    await homePage.syncStatus.getByRole('link', {name: 'Reconnect'}).click();
    await expect(page).toHaveURL(/\/bank-connections$/);
  });

  test('retains totals for a sanitized expired connection and offers reconnect', async ({
    page,
    homePage,
  }) => {
    await mockBankConnections(page, [
      {
        id: '00000000-0000-4000-8000-0000000000bb',
        provider: 'enable-banking',
        aspspName: 'Sample Bank',
        aspspCountry: 'NL',
        status: 'EXPIRED',
        syncStatus: 'IDLE',
        consentValidUntil: null,
        lastSyncedAt: null,
        lastSyncError: null,
        nextSyncAt: null,
        baseCurrency: 'EUR',
        bankAccounts: [
          {
            id: '00000000-0000-4000-8000-0000000000cc',
            name: 'Sample retained account',
            details: null,
            alias: null,
            currency: 'EUR',
            cashAccountType: null,
            usage: null,
            maskedIdentifier: null,
            currentBalanceAmount: '100.00',
            currentBalanceInBaseCurrency: '100.00',
            baseCurrencyRateDate: null,
            currentBalanceType: 'CLBD',
            balanceUpdatedAt: '2026-09-30T10:00:00.000Z',
            isActive: true,
            latestBalances: [],
          },
        ],
      },
    ]);
    await mockJson(page, '**/bank-transactions/summary**', septemberSpending('1200.00'));
    await page.goto('/?month=2026-09');

    await expect(homePage.monthHeading).toHaveText('September 2026');
    await expect(homePage.emptyStateTitle).toBeHidden();
    await expect(
      page.getByTestId('category-breakdown').getByText('€1,200.00', {exact: true}),
    ).toBeVisible();
    const balances = page.getByRole('region', {name: 'Balances'});
    await expect(
      balances
        .getByRole('link', {name: /Sample retained account/})
        .getByText('€100.00', {exact: true}),
    ).toBeVisible();
    await expect(balances.getByText('Total', {exact: true}).locator('..')).toContainText('€100.00');
    await expect(homePage.syncStatus).toContainText('Sample Bank has not synced yet');
    await expect(homePage.syncStatus).toContainText('Totals may be missing recent activity.');
    await homePage.syncStatus.getByRole('link', {name: 'Reconnect', exact: true}).click();
    await expect(page).toHaveURL(/\/bank-connections$/);
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

  test('fits a phone screen', async ({page, homePage}) => {
    await page.setViewportSize({width: 390, height: 844});
    await page.goto('/?month=2026-08');

    await expect(homePage.monthHeading).toHaveText('August 2026');
    await expectNoHorizontalOverflow(page);
  });
});
