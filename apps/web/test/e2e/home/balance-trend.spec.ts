import type {Page} from '@playwright/test';

import {VERIFIED_USER_AUTH_FILE} from '../../constants/auth.constants';
import {SEEDED_TRANSACTION_YEAR_NOW} from '../../constants/seed.constants';
import {expect, test} from '../../fixtures';
import {fulfillJson, transformBankConnections} from '../../utils/api-mocks';
import {expectNoHorizontalOverflow} from '../../utils/layout';

test.use({storageState: VERIFIED_USER_AUTH_FILE});
test.beforeEach(async ({page}) => {
  await page.clock.setFixedTime(SEEDED_TRANSACTION_YEAR_NOW);
});

const card = (page: Page) => page.getByTestId('balance-trend');
const table = (page: Page, interval: string) =>
  card(page).getByRole('table', {name: `Total balance per ${interval}`, includeHidden: true});

const CURRENT = '00000000-0000-4000-8000-0000000000a1';
const SAVINGS = '00000000-0000-4000-8000-0000000000a2';

const month = (
  start: string,
  end: string,
  current: string,
  savings: string | null,
  complete = true,
): {
  start: string;
  end: string;
  complete: boolean;
  total: string | null;
  accounts: {id: string; balance: string | null}[];
} => ({
  start,
  end,
  complete,
  total: (Number(current) + Number(savings ?? 0)).toFixed(2),
  accounts: [
    {id: CURRENT, balance: current},
    {id: SAVINGS, balance: savings},
  ],
});

const MONTHS = [
  month('2026-07-01', '2026-07-31', '1000.00', null),
  month('2026-08-01', '2026-08-31', '1200.00', '500.00'),
  month('2026-09-01', '2026-09-30', '900.00', '700.00'),
  month('2026-10-01', '2026-10-01', '2400.00', '700.00', false),
];

/** Two synthetic accounts; savings history starts in August. */
async function mockAccounts(page: Page, periods = MONTHS) {
  await transformBankConnections(page, (connections) =>
    connections.map((connection, index) => ({
      ...connection,
      baseCurrency: 'EUR',
      bankAccounts:
        index === 0
          ? [
              {...connection.bankAccounts[0], id: CURRENT, alias: 'Everyday'},
              {...connection.bankAccounts[0], id: SAVINGS, alias: 'Rainy day'},
            ]
          : connection.bankAccounts,
    })),
  );
  await page.route('**/bank-transactions/balance-trend**', (route) =>
    fulfillJson(route, {
      baseCurrency: 'EUR',
      interval: new URL(route.request().url()).searchParams.get('interval'),
      accounts: [
        {id: CURRENT, since: '2026-07-02'},
        {id: SAVINGS, since: '2026-08-05'},
      ],
      periods,
    }),
  );
}

test('ends today on the live balances from the API', async ({page}) => {
  await page.goto('/');
  const rows = table(page, 'month').getByRole('row', {includeHidden: true});
  // A header row and at least the running month.
  await expect.poll(() => rows.count()).toBeGreaterThan(1);
  await expect(rows.last()).toContainText('Today');
});

test('states today’s total, the change since the first point and when accounts join', async ({
  page,
}) => {
  await mockAccounts(page);
  await page.goto('/');
  await expect(card(page)).toContainText(
    '€3,100.00 today · +€1,400.00 (+140%) since end of July 2026',
  );
  await expect(card(page)).toContainText(
    'Rainy day counts from August 2026, when its history in Tempo starts, and is left out of the change.',
  );
  await expect(card(page)).toContainText('Balance at the end of each month');
  await expect(
    table(page, 'month').getByRole('row', {name: /31 Aug 2026/, includeHidden: true}),
  ).toContainText('€1,700');
});

test('leaves out a point whose exchange rate is missing and says so', async ({page}) => {
  await mockAccounts(page, [
    MONTHS[0],
    {...MONTHS[1], total: null, accounts: [MONTHS[1].accounts[0], {id: SAVINGS, balance: null}]},
    ...MONTHS.slice(2),
  ]);
  await page.goto('/');
  await expect(card(page)).toContainText('One point is left out until its exchange rate is in.');
  await expect(
    table(page, 'month').getByRole('row', {name: /31 Aug 2026/, includeHidden: true}),
  ).toHaveCount(0);
});

test('switches to weeks and years and fits a phone', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await mockAccounts(page);
  await page.goto('/');
  await card(page).getByRole('radio', {name: 'Week'}).click();
  await expect(card(page)).toContainText('Balance at the end of each week');
  await card(page).getByRole('radio', {name: 'Year'}).click();
  await expect(card(page)).toContainText('Balance at the end of each year');
  await expect(card(page)).not.toContainText('counts from');
  await expectNoHorizontalOverflow(page);
});

test('offers a retry when the trend fails to load', async ({page}) => {
  // A rate limit is final, so the card shows the error without waiting out the retries.
  await page.route('**/bank-transactions/balance-trend**', (route) =>
    fulfillJson(route, {statusCode: 429, message: 'ThrottlerException: Too Many Requests'}, 429),
  );
  await page.goto('/');
  await expect(card(page)).toContainText('Could not load the balance trend.');
  await expect(card(page).getByRole('button', {name: 'Try again'})).toBeVisible();
});
