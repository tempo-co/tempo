import type {Page} from '@playwright/test';

import type {BankTransactionSummary} from '@/features/dashboard/types/bank-transaction-summary';

import {VERIFIED_USER_AUTH_FILE} from '../../constants/auth.constants';
import {SEEDED_TRANSACTION_YEAR_NOW} from '../../constants/seed.constants';
import {API_URL, expect, test} from '../../fixtures';
import {fulfillJson} from '../../utils/api-mocks';
import {expectNoHorizontalOverflow} from '../../utils/layout';

test.use({storageState: VERIFIED_USER_AUTH_FILE});
test.beforeEach(async ({page}) => {
  await page.clock.setFixedTime(SEEDED_TRANSACTION_YEAR_NOW);
});

const card = (page: Page) => page.getByTestId('cash-flow');
const groupBy = (page: Page, name: 'Week' | 'Month' | 'Year') =>
  card(page).getByRole('radio', {name}).click();
const table = (page: Page, interval: string) =>
  card(page).getByRole('table', {name: `Spending and income per ${interval}`, includeHidden: true});

/** Activates a row link in the screen-reader table, the keyboard path to every bar. */
async function openRow(page: Page, interval: string, name: string) {
  await table(page, interval).getByRole('link', {name, exact: true, includeHidden: true}).focus();
  await page.keyboard.press('Enter');
}

function bookingRange(page: Page) {
  const search = new URL(page.url()).searchParams;
  // Only the rows the bar counts: spending and income with a base-currency amount.
  expect(JSON.parse(search.get('cashFlows')!)).toEqual(['SPENDING', 'INCOME']);
  expect(search.get('baseAmount')).toBe('PRESENT');
  return JSON.parse(search.get('bookingDate')!) as {from: string; to: string};
}

const localMidnight = (page: Page, year: number, month: number, day: number) =>
  page.evaluate(([y, m, d]) => new Date(y, m, d).toISOString(), [year, month, day]);

test('months match the monthly summary and select the month for the rest of Home', async ({
  page,
}) => {
  const response = await page.request.get(
    `${API_URL}/bank-transactions/summary?month=2026-08&asOf=2026-09-01`,
  );
  const summary = (await response.json()) as BankTransactionSummary;
  const spent = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: summary.baseCurrency!,
  }).format(Number(summary.totals.spending));
  await page.goto('/?month=2026-08');
  const august = table(page, 'month').getByRole('row', {name: /August 2026/, includeHidden: true});
  await expect(august).toContainText(spent);
  await expect(page.getByTestId('cash-flow-selected-month')).toContainText(spent);

  // Income and what was left for the selected month sit under the chart.
  await expect(page.getByTestId('cash-flow-selected-month')).toContainText('August 2026 spent');

  await page.goto('/');
  await openRow(page, 'month', 'August 2026');
  await expect(page).toHaveURL(/month=2026-08/);
  await expect(page.getByRole('heading', {level: 1})).toHaveText('August 2026');
});

test('a week opens exactly its Monday-to-Sunday transactions', async ({page}) => {
  await page.goto('/');
  await groupBy(page, 'Week');
  await openRow(page, 'week', '17–23 Aug');
  await expect(page).toHaveURL(/\/bank-transactions/);
  expect(bookingRange(page)).toEqual({
    from: await localMidnight(page, 2026, 7, 17),
    to: await localMidnight(page, 2026, 7, 23),
  });
});

test('a year opens its transactions through today', async ({page}) => {
  await page.goto('/');
  await groupBy(page, 'Year');
  await openRow(page, 'year', '2026');
  await expect(page).toHaveURL(/\/bank-transactions/);
  expect(bookingRange(page)).toEqual({
    from: await localMidnight(page, 2026, 0, 1),
    to: await localMidnight(page, 2026, 9, 1),
  });
});

const week = (start: string, end: string, spending: string, complete = true) => ({
  start,
  end,
  complete,
  spending,
  income: '0.00',
  net: `-${spending}`,
});

test('weeks compare last week with the median week, not the rent-skewed mean', async ({page}) => {
  await page.route('**/bank-transactions/cash-flow**', (route) =>
    fulfillJson(route, {
      baseCurrency: 'EUR',
      interval: 'week',
      periods: [
        week('2026-08-31', '2026-09-06', '100.00'),
        week('2026-09-07', '2026-09-13', '400.00'),
        week('2026-09-14', '2026-09-20', '250.00'),
        week('2026-09-21', '2026-09-27', '300.00'),
        week('2026-09-28', '2026-10-01', '50.00', false),
      ],
    }),
  );
  await page.goto('/');
  await groupBy(page, 'Week');
  await expect(card(page)).toContainText('Average week (4 full weeks): €262.50 spent');
  await expect(card(page)).toContainText(
    'Last week (21–27 Sep) vs a typical week: €50.00 more spent (+20%)',
  );
  await expect(card(page)).toContainText('typical €250.00, the median of the 3 weeks before');
  await expect(card(page)).toContainText('This week so far');
});

test('years drop cents, mark partial years and compare only full ones', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.route('**/bank-transactions/cash-flow**', (route) =>
    fulfillJson(route, {
      baseCurrency: 'EUR',
      interval: 'year',
      periods: [
        {...week('2024-01-01', '2024-12-31', '6000.40', false), income: '7900.00'},
        {...week('2025-01-01', '2025-12-31', '35400.19'), income: '39900.00'},
        {...week('2026-01-01', '2026-10-01', '28500.00', false), income: '30000.00'},
      ],
    }),
  );
  await page.goto('/');
  await groupBy(page, 'Year');
  await expect(card(page)).toContainText('2025: spent €35,400, income €39,900');
  await expect(card(page)).toContainText('Partial period');
  // One full year is not an average.
  await expect(card(page)).not.toContainText('Average year');
  await expect(card(page).locator('.recharts-yAxis-tick-labels')).toContainText('€');
  await expectNoHorizontalOverflow(page);
});
