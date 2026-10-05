import type {BankConnection} from '../../../src/features/banking/types/bank-connection';
import {VERIFIED_USER_AUTH_FILE} from '../../constants/auth.constants';
import {SEEDED_TRANSACTION_YEAR_NOW} from '../../constants/seed.constants';
import {expect, test} from '../../fixtures';
import {mockBankConnections, transformBankConnections} from '../../utils/api-mocks';
import {expectNoHorizontalOverflow} from '../../utils/layout';

test.describe('Home without banks', () => {
  test('prompts to connect a bank', async ({page, homePage, freshAccount}) => {
    await page.goto('/');
    await expect(homePage.sidebarAccountEmail).toHaveText(freshAccount.email);

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

  test('shows the current month for a future or invalid month', async ({page, homePage}) => {
    await page.goto('/?month=2027-01');
    await expect(homePage.monthHeading).toHaveText('October 2026');
    await expect(homePage.nextMonthButton).toBeDisabled();

    await page.goto('/?month=2026-13');
    await expect(homePage.monthHeading).toHaveText('October 2026');
  });

  test('says when the seeded bank last synced', async ({homePage, page}) => {
    await page.goto('/');
    await expect(homePage.syncStatus).toHaveText('Your bank synced about 1 month ago');
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
