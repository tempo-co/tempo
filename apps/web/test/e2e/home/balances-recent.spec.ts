import {VERIFIED_USER_AUTH_FILE} from '../../constants/auth.constants';
import {SEEDED_TRANSACTION_YEAR_NOW} from '../../constants/seed.constants';
import {expect, test} from '../../fixtures';
import {transformBankConnections} from '../../utils/api-mocks';
import {expectNoHorizontalOverflow} from '../../utils/layout';

test.use({storageState: VERIFIED_USER_AUTH_FILE});

test('shows foreign balance provenance and excludes missing conversions', async ({page}) => {
  await page.clock.setFixedTime(SEEDED_TRANSACTION_YEAR_NOW);
  await transformBankConnections(page, (connections) =>
    connections.map((connection) => ({
      ...connection,
      baseCurrency: 'EUR',
      syncStatus: 'FAILED',
      bankAccounts: [
        {
          ...connection.bankAccounts[0],
          currency: 'USD',
          currentBalanceAmount: '125.00',
          currentBalanceInBaseCurrency: '100.00',
          baseCurrencyRateDate: '2026-09-30',
        },
        {
          ...connection.bankAccounts[0],
          id: '00000000-0000-4000-8000-000000000099',
          alias: 'Travel wallet',
          currency: 'CHF',
          currentBalanceAmount: '50.00',
          currentBalanceInBaseCurrency: null,
          baseCurrencyRateDate: null,
        },
        {
          ...connection.bankAccounts[0],
          id: '00000000-0000-4000-8000-000000000098',
          alias: 'Empty wallet',
          currency: 'GBP',
          currentBalanceAmount: '0.00',
          currentBalanceInBaseCurrency: '0.00',
          baseCurrencyRateDate: '2026-09-30',
        },
      ],
    })),
  );
  await page.setViewportSize({width: 390, height: 844});
  await page.goto('/?month=2026-08');
  const balances = page.getByRole('region', {name: 'Balances'});
  await expect(balances).toContainText('≈ €100.00 · ECB rate of 30 Sep 2026');
  await expect(balances).toContainText('€100.00 excluding Travel wallet');
  await expect(balances.getByRole('listitem').filter({hasText: 'Empty wallet'})).not.toContainText(
    'ECB rate',
  );
  await expect(balances).toContainText('not synced since 26 Aug');
  await expect(balances).toContainText('today');
  await expectNoHorizontalOverflow(page);
});

test('recent transactions open the existing detail dialog', async ({page}) => {
  await page.goto('/?month=2026-08');
  const recent = page.getByRole('region', {name: 'Latest in August 2026'});
  await expect(recent.getByRole('link', {name: /Coffee shop/})).toBeVisible();
  await recent.getByRole('link', {name: /Coffee shop/}).click();
  await expect(page).toHaveURL(/transactionId=/);
  await expect(page.getByRole('dialog')).toBeVisible();
});
