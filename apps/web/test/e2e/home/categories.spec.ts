import {VERIFIED_USER_AUTH_FILE} from '../../constants/auth.constants';
import {SEEDED_TRANSACTION_YEAR_NOW} from '../../constants/seed.constants';
import {categorySummary} from '../../data/home-categories.data';
import {expect, test} from '../../fixtures';
import {mockJson} from '../../utils/api-mocks';
import {expectNoHorizontalOverflow} from '../../utils/layout';

test.use({storageState: VERIFIED_USER_AUTH_FILE});
test.beforeEach(async ({page}) => {
  await page.clock.setFixedTime(SEEDED_TRANSACTION_YEAR_NOW);
  await mockJson(page, '**/bank-transactions/summary**', categorySummary);
});

test('shows six positive categories, remaining count and refunds last', async ({page}) => {
  await page.goto('/?month=2026-09');
  const card = page.getByTestId('category-breakdown');
  await expect(card.getByRole('heading', {name: 'Where it went'})).toBeVisible();
  const links = card.getByRole('link');
  await expect(links).toHaveCount(8);
  const labels = [
    'Housing and utilities',
    'Food and drink',
    'Transportation',
    'Shopping',
    'Subscriptions',
    'Uncategorized',
    '2 more categories',
    'Refunds (subtracted)',
  ];
  for (const [index, label] of labels.entries()) {
    await expect(links.nth(index)).toContainText(label);
  }
  await expect(links.last()).toContainText('-€40.00');
  await expect(card).not.toContainText('Payments to people');
});

test('drills to the exact category and booking range', async ({page}) => {
  await page.goto('/?month=2026-09');
  const link = page.getByTestId('category-breakdown').getByRole('link', {name: /Food and drink/});
  const href = await link.getAttribute('href');
  expect(href).not.toBeNull();
  const search = new URL(href!, page.url()).searchParams;
  expect(JSON.parse(search.get('categories')!)).toEqual(['FOOD_AND_DRINK']);
  expect(JSON.parse(search.get('cashFlows')!)).toEqual(['SPENDING']);
  expect(search.get('baseAmount')).toBe('PRESENT');
  const range = JSON.parse(search.get('bookingDate')!) as {from: string; to: string};
  expect(new Date(range.from).getDate()).toBe(1);
  expect(new Date(range.to).getDate()).toBe(30);
  expect(new Date(range.from).getMonth()).toBe(8);
  expect(new Date(range.to).getFullYear()).toBe(2026);
  await link.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/bank-transactions/);
});

test('remaining categories drill excludes the top six and refunds', async ({page}) => {
  await page.goto('/?month=2026-09');
  const link = page
    .getByTestId('category-breakdown')
    .getByRole('link', {name: /2 more categories/});
  const href = await link.getAttribute('href');
  expect(href).not.toBeNull();
  const search = new URL(href!, page.url()).searchParams;
  expect(JSON.parse(search.get('categories')!)).toEqual(['TRANSFER_OUT', 'OTHER']);
  expect(JSON.parse(search.get('cashFlows')!)).toEqual(['SPENDING']);
  expect(search.get('baseAmount')).toBe('PRESENT');
});

test('shows counts, threshold comparisons and the usual tick', async ({page}) => {
  await page.goto('/?month=2026-09');
  const card = page.getByTestId('category-breakdown');
  await expect(card.getByRole('link', {name: /Housing and utilities/})).toContainText(
    '2 transactions · about usual',
  );
  const food = card.getByRole('link', {name: /Food and drink/});
  await expect(food).toContainText('12 transactions · +100%');
  await expect(food.getByRole('img', {name: 'Usual spending: €200.00'})).toBeVisible();
  await expect(card.getByRole('link', {name: /Transportation/})).toContainText(
    '6 transactions · −25%',
  );
  await expect(card.getByRole('link', {name: /Shopping/})).toContainText(
    '3 transactions · about usual',
  );
  await expect(card.getByRole('link', {name: /Subscriptions/})).toContainText(
    '1 transaction · usually €10.00',
  );
  const uncategorized = card.getByRole('link', {name: /Uncategorized/});
  await expect(uncategorized).toContainText('2 transactions');
  await expect(uncategorized.getByRole('img')).toHaveCount(0);
});

test('empty spending explains the period without a more-categories link', async ({page}) => {
  await mockJson(page, '**/bank-transactions/summary**', {...categorySummary, categories: []});
  await page.goto('/?month=2026-09');
  const card = page.getByTestId('category-breakdown');
  await expect(card).toContainText('No spending this month.');
  await expect(card.getByRole('link')).toHaveCount(0);
});

test('fits a phone with current-month comparison context and a zero baseline', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await mockJson(page, '**/bank-transactions/summary**', {
    ...categorySummary,
    month: '2026-10',
    through: '2026-10-01',
    daysInMonth: 31,
    categories: [categorySummary.categories[6]],
  });
  await page.goto('/');
  const card = page.getByTestId('category-breakdown');
  await expect(card).toContainText('Compared with usual by this day of the month.');
  await expect(card.getByRole('link', {name: /Transfer out/})).toContainText(
    '1 transaction · usually €0.00',
  );
  await expectNoHorizontalOverflow(page);
});
