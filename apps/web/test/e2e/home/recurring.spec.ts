import type {Page} from '@playwright/test';

import type {RecurringSummary} from '../../../src/features/banking/types/recurring-series';
import {VERIFIED_USER_AUTH_FILE} from '../../constants/auth.constants';
import {SEEDED_TRANSACTION_YEAR_NOW} from '../../constants/seed.constants';
import {API_URL, expect, test} from '../../fixtures';
import {fulfillJson} from '../../utils/api-mocks';
import {expectNoHorizontalOverflow} from '../../utils/layout';

test.use({storageState: VERIFIED_USER_AUTH_FILE, timezoneId: 'Europe/Amsterdam'});
test.beforeEach(async ({page}) => {
  await page.clock.setFixedTime(SEEDED_TRANSACTION_YEAR_NOW);
});

const summary: RecurringSummary = {
  expenseMonthlyTotal: '129.99',
  incomeMonthlyTotal: '2500.00',
  upcoming: [
    {
      key: 'a'.repeat(32),
      name: 'Example Gym',
      direction: 'EXPENSE',
      nextExpectedDate: '2026-10-03',
      typicalAmount: '30.00',
      amountKind: 'FIXED',
      currency: 'EUR',
      category: 'SUBSCRIPTIONS',
      merchantLogoUrl: null,
      flags: [],
    },
    {
      key: 'b'.repeat(32),
      name: 'Example Energy',
      direction: 'EXPENSE',
      nextExpectedDate: '2026-10-08',
      typicalAmount: '78.50',
      amountKind: 'VARIABLE',
      currency: 'EUR',
      category: 'HOUSING_AND_UTILITIES',
      merchantLogoUrl: null,
      flags: [],
    },
    {
      key: 'e'.repeat(32),
      name: 'Example Employer',
      direction: 'INCOME',
      nextExpectedDate: '2026-10-25',
      typicalAmount: '2500.00',
      amountKind: 'FIXED',
      currency: 'EUR',
      category: 'INCOME',
      merchantLogoUrl: null,
      flags: [],
    },
  ],
  expenseThisMonth: {month: '2026-10', paid: '21.49', remaining: '108.50'},
  incomeThisMonth: {month: '2026-10', paid: '0.00', remaining: '2500.00'},
  expenseUnconvertedCount: 0,
  incomeUnconvertedCount: 0,
  baseCurrency: 'EUR',
};

const card = (page: Page) => page.getByRole('region', {name: 'Recurring payments'});

for (const viewport of [
  {width: 1280, height: 800},
  {width: 390, height: 844},
]) {
  test(`shows recurring bills, income and what is due next at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const dates: string[] = [];
    await page.route('**/recurring-series/summary?**', (route) => {
      dates.push(new URL(route.request().url()).searchParams.get('asOf')!);
      return fulfillJson(route, summary);
    });
    await page.goto('/');

    await expect(card(page)).toContainText('Monthly bills€129.99');
    await expect(card(page)).toContainText('€108.50 due this month');
    await expect(card(page)).toContainText('Monthly income+€2,500.00');
    const upcoming = card(page).getByRole('listitem');
    await expect(upcoming).toHaveCount(3);
    await expect(upcoming.nth(0)).toContainText('Example Gym');
    await expect(upcoming.nth(0)).toContainText('In 2 days');
    await expect(upcoming.nth(0)).toContainText('€30.00');
    await expect(upcoming.nth(0)).not.toContainText('≈');
    // A varying bill's next payment is an estimate.
    await expect(upcoming.nth(1)).toContainText('8 Oct');
    await expect(upcoming.nth(1)).toContainText('≈ €78.50');
    await expect(upcoming.nth(2)).toContainText('+€2,500.00');
    expect(dates).toEqual(['2026-10-01']);
    await expectNoHorizontalOverflow(page);

    // The full list opens over Home, and Back closes it.
    await card(page).getByRole('button', {name: 'See all recurring payments'}).click();
    const dialog = page.getByRole('dialog', {name: 'Recurring payments'});
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/[?&]recurring=open/);
    await page.goBack();
    await expect(dialog).toBeHidden();
    await expect(card(page)).toBeVisible();

    // Closing it in the dialog leaves no extra Home entry behind: Back then leaves Home.
    await card(page).getByRole('button', {name: 'See all recurring payments'}).click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page).not.toHaveURL(/recurring=open/);
    await page.goBack();
    await expect(page).toHaveURL('about:blank');
    await page.goto('/recurring');
    await expect(page.getByRole('dialog', {name: 'Recurring payments'})).toBeHidden();
  });
}

test('shows what the real summary endpoint returns for the seeded owner', async ({page}) => {
  const response = await page.request.get(`${API_URL}/recurring-series/summary?asOf=2026-10-01`);
  expect(response.status()).toBe(200);
  const real = (await response.json()) as RecurringSummary;
  await page.goto('/');
  if (real.upcoming.length === 0 && Number(real.expenseMonthlyTotal) === 0) {
    await expect(card(page)).toContainText('No recurring payments found yet');
  } else {
    await expect(card(page)).toContainText(real.upcoming[0].name);
  }
});

test('says when nothing recurring is found yet', async ({page}) => {
  await page.route('**/recurring-series/summary?**', (route) =>
    fulfillJson(route, {
      ...summary,
      expenseMonthlyTotal: '0.00',
      incomeMonthlyTotal: '0.00',
      upcoming: [],
    }),
  );
  await page.goto('/');
  await expect(card(page)).toContainText('No recurring payments found yet');
});

test('says how many bills the total leaves out until they are converted', async ({page}) => {
  await page.route('**/recurring-series/summary?**', (route) =>
    fulfillJson(route, {...summary, expenseUnconvertedCount: 2, incomeUnconvertedCount: 1}),
  );
  await page.goto('/');
  await expect(card(page)).toContainText('€129.99');
  await expect(card(page)).toContainText('2 not converted yet');

  // Unconverted income is not counted against the bills.
  await page.unrouteAll();
  await page.route('**/recurring-series/summary?**', (route) =>
    fulfillJson(route, {...summary, incomeUnconvertedCount: 1}),
  );
  await page.reload();
  await expect(card(page)).toContainText('Monthly bills€129.99');
  await expect(card(page)).not.toContainText('not converted');
});
