import type {BankConnection} from '@wisp/contracts';

import {HOME_USER_AUTH_FILE} from '../../constants/auth.constants';
import {HOME_CONNECTION, HOME_NOW, mockSyntheticHome} from '../../data/home-history.data';
import {expect, test} from '../../fixtures';
import {mockJson} from '../../utils/api-mocks';
import {expectLoaded, expectNoHorizontalOverflow} from '../../utils/layout';

test.describe('Home without banks', () => {
  // The empty Home and the first run from it: `first-run.spec.ts`.
  test('ignores connections that never finished authorizing', async ({
    page,
    homePage,
    freshAccount: _account,
  }) => {
    await mockSyntheticHome(page, {
      connections: [
        {
          ...HOME_CONNECTION,
          id: '00000000-0000-4000-8000-0000000000aa',
          status: 'PENDING_AUTHORIZATION',
          syncStatus: 'IDLE',
          bankAccounts: [],
        },
      ],
    });
    await page.goto('/');

    await expect(homePage.emptyStateTitle).toBeVisible();
  });
});

test.describe('Home', () => {
  test.use({storageState: HOME_USER_AUTH_FILE, timezoneId: 'Europe/Amsterdam'});

  test.beforeEach(async ({page}) => {
    await page.clock.setFixedTime(new Date('2026-10-20T12:00:00.000Z'));
  });

  test('shows the month against the usual pace up to the last synced day, how far the data runs, and what to check', async ({
    page,
    homePage,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', {level: 1})).toHaveText('Good afternoon, Alex');

    // The bank last synced on 14 October; the savings file runs to 2 October.
    await expect(homePage.paceFigure).toHaveText('€1,119');
    await expect(homePage.paceCard.getByTestId('pace-up-to')).toHaveText(
      'spent in October, up to 14 Oct',
    );
    // April to September, each added up to the 14th, average €1,094.05.
    await expect(homePage.paceCard.getByTestId('pace-comparison')).toHaveText(
      '€25 over your usual pace',
    );
    await expect(homePage.paceCard).toContainText('Usual month€1,178');

    const data = homePage.card('Your data');
    await expect(data).toContainText('Your data runs up to 14 Oct');
    await expect(data).toContainText('Savings');
    // Both accounts cover 21 September to 2 October, the bank alone up to 14 October, nothing after.
    await expect(data.getByTestId('coverage-strip')).toHaveAccessibleName(
      'The last 30 days: 12 covered by every account, 12 by some, 6 by none',
    );

    await expect(homePage.accountsTotal).toHaveText('€7,584.60');

    const toDo = homePage.card('To do');
    await expect(toDo).toContainText('Check 2 transactions');
    await toDo.getByRole('link', {name: 'Check'}).click();
    await expect(page).toHaveURL(/\/transactions\?needsAttention=true$/);
  });

  test('keeps hidden and reordered cards on this device', async ({page, homePage}) => {
    await page.goto('/');
    await expect(homePage.paceFigure).toBeVisible();
    await page.getByRole('button', {name: 'Customize'}).click();
    await homePage.card('Accounts').getByRole('button', {name: 'Move Accounts up'}).click();
    await homePage
      .card('Recent transactions')
      .getByRole('button', {name: 'Hide Recent transactions'})
      .click();
    await expect(homePage.card('Recent transactions')).toHaveCount(0);
    await expect(page.getByRole('region', {name: 'Customize Home'})).toContainText(
      'Show Recent transactions',
    );
    await page.getByRole('button', {name: 'Done'}).click();

    await page.reload();
    await expect(homePage.paceFigure).toBeVisible();
    await expect(homePage.card('Recent transactions')).toHaveCount(0);
    const main = page.getByRole('main').getByRole('region');
    await expect(main.first()).toHaveAccessibleName('Spending pace');
    await expect(main.nth(1)).toHaveAccessibleName('Accounts');
    await expect(main.nth(2)).toHaveAccessibleName('Top categories this month');

    await page.getByRole('button', {name: 'Customize'}).click();
    await page.getByRole('button', {name: 'Show Recent transactions'}).click();
    await expect(homePage.card('Recent transactions')).toBeVisible();
  });
});

test.describe('Home navigation badges', () => {
  test.use({storageState: {cookies: [], origins: []}, timezoneId: 'Europe/Amsterdam'});

  test('Transactions counts what needs review and Accounts flags a bank to reconnect', async ({
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
    // Two to check and one failed; the five still categorizing are not counted.
    const transactions = primary.getByRole('link', {name: 'Transactions, 3 to check'});
    await expect(transactions).toHaveText('Transactions3');
    await expect(
      primary.getByRole('link', {name: 'Accounts, a bank needs attention'}),
    ).toBeVisible();
    // A retained expired bank still counts towards the totals.
    await expect(homePage.accountsTotal).toHaveText('€48,600.00');

    await transactions.click();
    await expect(page).toHaveURL(/\/transactions/);
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

  test('Accounts flags a bank whose consent ends within a week, and its card offers re-authorizing', async ({
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
      .getByRole('link', {name: 'Accounts, a bank needs re-authorizing soon'});
    await expect(connections).toBeVisible();

    await connections.click();
    await expect(page).toHaveURL(/\/accounts$/);
    const notice = page.locator('[data-testid="account-freshness"][data-tone="warning"]');
    await expect(notice).toContainText('Access ends in 3 days · reconnect to keep syncing');
    await expect(notice.getByRole('button', {name: 'Reconnect'})).toBeVisible();
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
    await page.goto('/accounts');
    const notice = page.locator('[data-testid="account-freshness"][data-tone="warning"]');
    await expect(notice).toHaveCount(1);
    await expect(notice).toContainText('Access ends in 3 days');
    await expect(notice.getByRole('button', {name: 'Reconnect'})).toBeVisible();
  });

  for (const {name, connections, label} of [
    {
      name: 'consent ending in 10 days carries no badge',
      connections: [consentEndingIn('00000000-0000-4000-8000-0000000000c4', 10)],
      label: 'Accounts',
    },
    {
      name: 'several banks ending soon read as a count',
      connections: [
        consentEndingIn('00000000-0000-4000-8000-0000000000c5', 1),
        consentEndingIn('00000000-0000-4000-8000-0000000000c6', 6),
      ],
      label: 'Accounts, 2 banks need re-authorizing soon',
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
      label: 'Accounts, a bank needs attention and a bank needs re-authorizing soon',
    },
    {
      name: 'a broken bank and one ending soon are named together',
      connections: [expired, consentEndingIn('00000000-0000-4000-8000-0000000000c7', 3)],
      label: 'Accounts, a bank needs attention and a bank needs re-authorizing soon',
    },
  ]) {
    test(`Accounts badge: ${name}`, async ({page}) => {
      await mockSyntheticHome(page, {connections});
      await page.goto('/');
      const link = page
        .getByRole('navigation', {name: 'Primary'})
        .first()
        .getByRole('link', {name: label, exact: true});
      await expect(link).toBeVisible();
      await expect(link.locator('i')).toHaveCount(label === 'Accounts' ? 0 : 1);
    });
  }

  test('without anything to check or reconnect, the tabs carry no badge and To do steps aside', async ({
    page,
    homePage,
  }) => {
    await mockSyntheticHome(page, {
      reviewCounts: {
        needsReview: 0,
        categorizationFailed: 0,
        categorizing: 4,
        missingBaseAmount: 2,
        needsAttention: 0,
      },
    });
    await page.goto('/');
    const primary = page.getByRole('navigation', {name: 'Primary'}).first();
    await expect(homePage.paceFigure).toBeVisible();
    // With nothing to check and the setup done, To do steps aside.
    await expect(homePage.card('Your data')).toBeVisible();
    await expect(homePage.card('To do')).toHaveCount(0);
    await expect(primary.getByRole('link', {name: 'Transactions', exact: true})).toHaveText(
      'Transactions',
    );
    await expect(primary.getByRole('link', {name: 'Accounts', exact: true})).toBeVisible();
  });

  test('the phone tab bar carries the same badges', async ({page}) => {
    await page.setViewportSize({width: 390, height: 844});
    await mockSyntheticHome(page, {
      connections: [{...HOME_CONNECTION, status: 'EXPIRED', syncStatus: 'EXPIRED'}],
    });
    await page.goto('/');
    const tabs = page.getByRole('navigation', {name: 'Primary'}).last();
    await expect(tabs.getByRole('link', {name: 'Transactions, 3 to check'})).toBeVisible();
    await expect(tabs.getByRole('link', {name: 'Accounts, a bank needs attention'})).toBeVisible();
  });
});

test.describe('Home on a phone', () => {
  test.use({
    storageState: {cookies: [], origins: []},
    timezoneId: 'Europe/Amsterdam',
    viewport: {width: 390, height: 844},
  });

  test('fits the screen, and Accounts leaves out a hidden account and an all-clear sync line', async ({
    page,
    homePage,
  }) => {
    const hidden = {
      ...HOME_CONNECTION.bankAccounts[0],
      id: '00000000-0000-4000-8000-0000000000a9',
      name: 'Example Hidden Account',
      currentBalanceAmount: '900.00',
      currentBalanceInBaseCurrency: '900.00',
      isHidden: true,
    };
    await mockSyntheticHome(page, {
      connections: [{...HOME_CONNECTION, bankAccounts: [...HOME_CONNECTION.bankAccounts, hidden]}],
    });
    await page.goto('/');
    await expect(homePage.paceFigure).toHaveText('€1,200');
    await expect(homePage.accountsTotal).toHaveText('€24,300.00');
    await expect(homePage.card('Accounts')).toContainText('1 account');
    await expect(homePage.card('Accounts')).not.toContainText('Example Hidden Account');
    await expect(homePage.card('Accounts').getByText(/^Synced/)).toBeHidden();
    await expectLoaded(page.getByRole('main'));
    await expectNoHorizontalOverflow(page);

    // Wider, the sync line has room again.
    await page.setViewportSize({width: 768, height: 1024});
    await expect(homePage.card('Accounts').getByText(/^Synced/)).toBeVisible();
  });
});
