import {VERIFIED_USER_AUTH_FILE} from '../../constants/auth.constants';
import {SEEDED_TRANSACTION_YEAR_NOW} from '../../constants/seed.constants';
import {octoberFirstSummary, septemberSummary} from '../../data/home-summary.data';
import {expect, test} from '../../fixtures';
import {mockJson} from '../../utils/api-mocks';

test.use({storageState: VERIFIED_USER_AUTH_FILE});
test.beforeEach(async ({page}) => {
  await page.clock.setFixedTime(SEEDED_TRANSACTION_YEAR_NOW);
});

test('rejects year zero instead of crashing', async ({page}) => {
  await page.goto('/?month=0000-01');
  await expect(page.getByRole('heading', {level: 1})).toHaveText('October 2026');
});

test('retains a positive refund bucket in spending', async ({page}) => {
  await mockJson(page, '**/bank-transactions/summary**', {
    ...septemberSummary,
    categories: [{category: 'REFUND', spending: '50.00', count: 1, baselineAverage: null}],
  });
  await page.goto('/?month=2026-09');
  const breakdown = page.getByTestId('category-breakdown');
  await expect(breakdown.getByRole('link', {name: /Refund/})).toContainText('€50.00');
});

test('ranks a positive refund bucket by its amount', async ({page}) => {
  // The API lists REFUND last; Home ranks positive refunds with the other spending.
  const categories = [
    'HOUSING_AND_UTILITIES',
    'FOOD_AND_DRINK',
    'TRANSPORTATION',
    'SHOPPING',
    'INSURANCE',
    'HEALTH',
    'REFUND',
  ];
  await mockJson(page, '**/bank-transactions/summary**', {
    ...septemberSummary,
    categories: categories.map((category, index) => ({
      category,
      spending: category === 'REFUND' ? '500.00' : `${60 - index}.00`,
      count: 1,
      baselineAverage: null,
    })),
  });
  await page.goto('/?month=2026-09');
  const rows = page.getByTestId('category-breakdown').getByRole('link');
  await expect(rows.first()).toContainText('Refund');
  await expect(rows.first()).toContainText('€500.00');
});

test('shows a visible subject marker on the first day', async ({page}) => {
  await mockJson(page, '**/bank-transactions/summary**', octoberFirstSummary);
  await page.goto('/');
  await expect(
    page.getByTestId('spending-summary').locator('.recharts-line-dots circle'),
  ).toHaveCount(1);
});

test('does not relabel previous month rows during loading', async ({page}) => {
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
      new URL(route.request().url()).searchParams.get('filter[bookingDate][from]') === '2026-07-01'
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
