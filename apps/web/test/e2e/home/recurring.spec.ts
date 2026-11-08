import type {Page} from '@playwright/test';
import type {RecurringSummary} from '@tempo/contracts';

import {VERIFIED_USER_AUTH_FILE} from '../../constants/auth.constants';
import {SEEDED_TRANSACTION_YEAR_NOW} from '../../constants/seed.constants';
import {mockSyntheticHome} from '../../data/home-history.data';
import {API_URL, expect, test} from '../../fixtures';
import {fulfillJson} from '../../utils/api-mocks';
import {expectLoaded, expectNoHorizontalOverflow} from '../../utils/layout';

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
      name: 'Example Energy Supplier With A Long Contract Name',
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

const repeats = (page: Page) => page.getByRole('region', {name: 'Repeats'});

for (const viewport of [
  {width: 1280, height: 800},
  {width: 390, height: 844},
]) {
  test(`repeats show bills, income and what is due next at ${viewport.width}px`, async ({page}) => {
    await page.setViewportSize(viewport);
    const dates: string[] = [];
    await page.route('**/recurring-series/summary?**', (route) => {
      dates.push(new URL(route.request().url()).searchParams.get('asOf')!);
      return fulfillJson(route, summary);
    });
    await page.goto('/');

    await expect(repeats(page)).toContainText('Bills a month€130');
    await expect(repeats(page)).toContainText('Income a month€2,500');
    await expect(repeats(page)).toContainText('October: €21 paid · €109 to go');
    const upcoming = repeats(page).getByRole('listitem');
    await expect(upcoming.filter({hasText: 'Example Gym'})).toContainText(
      '3 Oct · in 2 days€30.00',
    );
    // A long name stays inside the block, and a varying bill's next payment is an estimate.
    await expect(
      upcoming.filter({hasText: 'Example Energy Supplier With A Long Contract Name'}),
    ).toContainText('≈ €78.50');
    await expect(upcoming.filter({hasText: 'Example Employer'})).toContainText('+€2,500.00');
    expect(new Set(dates)).toEqual(new Set(['2026-10-01']));
    await expectNoHorizontalOverflow(page);

    // The full list opens over Home, and Back closes it.
    await repeats(page).getByRole('button', {name: 'All recurring payments'}).click();
    const dialog = page.getByRole('dialog', {name: 'Recurring payments'});
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/[?&]recurring=open/);
    await page.goBack();
    await expect(dialog).toBeHidden();
    await expect(repeats(page)).toBeVisible();

    // Closing it in the dialog leaves no extra Home entry behind: Back then leaves Home.
    await repeats(page).getByRole('button', {name: 'All recurring payments'}).click();
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

test('repeats show what the real summary endpoint returns for the seeded owner', async ({page}) => {
  const response = await page.request.get(`${API_URL}/recurring-series/summary?asOf=2026-10-01`);
  expect(response.status()).toBe(200);
  const real = (await response.json()) as RecurringSummary;
  await page.goto('/');
  await expect(page.getByRole('region', {name: 'Where you stand'})).toBeVisible();
  await expectLoaded(page.getByRole('region', {name: 'Where you stand'}));
  if (Number(real.expenseMonthlyTotal) === 0 && Number(real.incomeMonthlyTotal) === 0) {
    await expect(repeats(page)).toHaveCount(0);
  } else if (real.upcoming.length > 0) {
    await expect(repeats(page)).toContainText(real.upcoming[0].name);
  } else {
    await expect(repeats(page)).toContainText('Bills a month');
  }
});

test('says how many bills the total leaves out until they are converted', async ({page}) => {
  await page.route('**/recurring-series/summary?**', (route) =>
    fulfillJson(route, {...summary, expenseUnconvertedCount: 2, incomeUnconvertedCount: 1}),
  );
  await page.goto('/');
  await expect(repeats(page)).toContainText('Bills a month€130');
  await expect(repeats(page)).toContainText('2 not converted yet');

  // Unconverted income is not counted against the bills.
  await page.unrouteAll();
  await page.route('**/recurring-series/summary?**', (route) =>
    fulfillJson(route, {...summary, incomeUnconvertedCount: 1}),
  );
  await page.reload();
  await expect(repeats(page)).toContainText('Bills a month€130');
  await expect(repeats(page)).not.toContainText('not converted');
});

test.describe('when what repeats cannot be read', () => {
  // Every response is synthetic: this check never reads a shared API stack.
  test.use({storageState: {cookies: [], origins: []}});

  test('Repeats says so in its place and loads on Try again', async ({page}) => {
    await mockSyntheticHome(page);
    const state = {failing: true};
    for (const url of ['**/recurring-series/summary?**', '**/recurring-series?**'])
      await page.route(url, (route) =>
        state.failing
          ? fulfillJson(route, {statusCode: 429, message: 'Too Many Requests'}, 429)
          : route.fallback(),
      );
    await page.goto('/');

    await expect(repeats(page)).toContainText('Could not load what repeats.');
    state.failing = false;
    await repeats(page).getByRole('button', {name: 'Try again'}).click();
    await expect(repeats(page)).toContainText('Bills a month€1,250');
    await expect(repeats(page)).toContainText('Income a month€3,000');
  });
});
