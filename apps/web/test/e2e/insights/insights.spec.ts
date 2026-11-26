import type {Page} from '@playwright/test';
import type {MerchantGroup, MerchantGroupsResponse} from '@tempo/contracts';

import {MARKET_ID, mockSyntheticHome, monthTransactions} from '../../data/home-history.data';
import {expect, test} from '../../fixtures';
import {fulfillJson} from '../../utils/api-mocks';

// Every response is synthetic: these checks never read or mutate a shared API stack.
test.use({storageState: {cookies: [], origins: []}, timezoneId: 'Europe/Amsterdam'});

const LANDLORD_ID = `k_${'e5'.repeat(16)}`;

/** Top merchants over any range: the landlord, then the market; records each request's range. */
async function mockInsightsMerchants(page: Page) {
  const ranges: string[] = [];
  await page.route('**/merchants?**', (route) => {
    const params = new URL(route.request().url()).searchParams;
    ranges.push(`${params.get('from')}..${params.get('to')}`);
    const item = (id: string, name: string, spent: string, count: number) => ({
      id,
      name,
      kind: 'MERCHANT' as const,
      logoUrl: null,
      spent,
      received: '0.00',
      count,
      lastDate: '2026-11-01',
    });
    return fulfillJson(route, {
      baseCurrency: 'EUR',
      merchants: [
        item(LANDLORD_ID, 'Example Landlord', '1200.00', 1),
        item(MARKET_ID, 'Example Market', '500.00', 9),
      ],
      total: 2,
    } satisfies MerchantGroupsResponse);
  });
  await page.route(`**/merchants/${MARKET_ID}`, (route) =>
    fulfillJson(route, {
      id: MARKET_ID,
      name: 'Example Market',
      kind: 'MERCHANT',
      logoUrl: null,
      spent: '9500.00',
      received: '0.00',
      count: 190,
      lastDate: '2026-10-28',
      baseCurrency: 'EUR',
      paid: '9500.00',
      refunded: '0.00',
      paymentCount: 190,
      averagePayment: '50.00',
      firstDate: '2024-12-02',
      excluded: {missingBaseAmount: 0},
      variants: [],
    } satisfies MerchantGroup),
  );
  await page.route(`**/merchants/${MARKET_ID}/periods?**`, (route) =>
    fulfillJson(route, {baseCurrency: 'EUR', interval: 'month', periods: []}),
  );
  await page.route('**/bank-transactions?**', (route) =>
    fulfillJson(route, {...monthTransactions('2026-10', 3), total: 3}),
  );
  return ranges;
}

const figures = (page: Page) =>
  page.getByRole('region', {name: 'Cash flow'}).getByTestId('cash-flow-figure');

test('every figure follows the period picker, kept in the address, and Table shows the year and heat tables', async ({
  page,
}) => {
  await page.setViewportSize({width: 1440, height: 1000});
  await mockSyntheticHome(page);
  const ranges = await mockInsightsMerchants(page);
  await page.goto('/insights');

  const picker = page.getByRole('radiogroup', {name: 'Period'});
  // The last 12 months by default: December 2025 to the running November, which has only the rent so far.
  await expect(picker.getByRole('radio', {name: '12 months'})).toBeChecked();
  await expect(page.getByText('December 2025 – November 2026', {exact: true})).toBeVisible();
  await expect(figures(page)).toHaveText(['In+€33,000', 'Out€24,700', 'Kept+€8,30025% of income']);
  await expect(page.getByRole('region', {name: 'Balance'})).toContainText('€24,300');
  await expect.poll(() => ranges).toContain('2025-12-01..2026-11-05');

  await picker.getByRole('radio', {name: '2025'}).click();
  await expect(page).toHaveURL(/\/insights\?period=2025$/);
  await expect(figures(page)).toHaveText(['In+€40,000', 'Out€24,000', 'Kept+€16,00040% of income']);
  // The balance at the period's end, and the top merchants of the same span.
  await expect(page.getByRole('region', {name: 'Balance'})).toContainText('€17,000');
  await expect.poll(() => ranges).toContain('2025-01-01..2025-12-31');
  const flow = page.getByRole('region', {name: 'Where the money went'});
  await expect(flow.getByTestId('money-flow-target')).toHaveText([
    /^Housing and utilities€14,400 · 36%$/,
    /^Groceries€6,000 · 15%$/,
    /^Shopping€2,400 · 6%$/,
    /^Other \(3 categories\)€1,200 · 3%$/,
    /^Kept€16,000 · 40%$/,
  ]);
  const categories = page.getByRole('region', {name: 'Categories'});
  await expect(categories.getByRole('link').first()).toHaveText(
    /^Housing and utilities.*€1,200€14,400$/,
  );

  await picker.getByRole('radio', {name: 'This month'}).click();
  await expect(page).toHaveURL(/\/insights\?period=month$/);
  await expect(figures(page)).toHaveText(['In€0', 'Out€1,200', 'Kept−€1,200']);
  await expect.poll(() => ranges).toContain('2026-11-01..2026-11-05');
  // The address keeps the period through a reload.
  await page.reload();
  await expect(picker.getByRole('radio', {name: 'This month'})).toBeChecked();
  await expect(figures(page)).toHaveText(['In€0', 'Out€1,200', 'Kept−€1,200']);

  await picker.getByRole('radio', {name: '12 months'}).click();
  await expect(page).toHaveURL(/\/insights$/);
  const view = page.getByRole('tablist', {name: 'Cash flow view'});
  await view.getByRole('tab', {name: 'Table'}).click();
  await expect(page).toHaveURL(/\/insights\?view=table$/);
  await expect(page.getByRole('region', {name: 'Year by year'})).toBeVisible();
  // The tables cover the period too: 2025 only from December, 2026 so far.
  const spending = page.getByRole('region', {name: 'Spending by category'});
  await expect(spending.getByRole('columnheader', {name: /^2025/})).toHaveText(/from Dec/);
  await expect(spending.getByRole('columnheader', {name: /^2026/})).toHaveText(/so far/);
  await expect(page.getByRole('region', {name: 'Income by source'})).toBeVisible();
  await view.getByRole('tab', {name: 'Chart'}).click();
  await expect(page).toHaveURL(/\/insights$/);
  await expect(page.getByRole('region', {name: 'Year by year'})).toHaveCount(0);
  await expect(page.getByRole('list', {name: /^In and out per month/})).toBeVisible();
});

test('a merchant opens in the rail at its own address, and closing it shows the rail again', async ({
  page,
}) => {
  await page.setViewportSize({width: 1440, height: 1000});
  await mockSyntheticHome(page);
  await mockInsightsMerchants(page);
  await page.goto('/insights?period=2025');

  const top = page.getByRole('region', {name: 'Top merchants'});
  await top.getByRole('button', {name: /Example Market/}).click();
  await expect(page).toHaveURL(new RegExp(`/insights\\?period=2025&merchant=${MARKET_ID}$`));
  const details = page.getByRole('complementary', {name: 'Merchant'});
  await expect(details.getByRole('heading', {name: 'Example Market'})).toBeVisible();
  await expect(details.getByText('Spent all time€9,500.00')).toBeVisible();
  await expect(top).toHaveCount(0);

  await page.reload();
  await expect(details.getByRole('heading', {name: 'Example Market'})).toBeVisible();
  await details.getByRole('button', {name: 'Close merchant'}).click();
  await expect(page).toHaveURL(/\/insights\?period=2025$/);
  await expect(top).toBeVisible();
});

test('on a phone a merchant opens in a sheet over Insights', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await mockSyntheticHome(page);
  await mockInsightsMerchants(page);
  await page.goto('/insights');

  await page
    .getByRole('region', {name: 'Top merchants'})
    .getByRole('button', {name: /Example Market/})
    .click();
  const sheet = page.getByRole('dialog', {name: 'Merchant'});
  await expect(sheet.getByText('Spent all time€9,500.00')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`merchant=${MARKET_ID}$`));
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(page).toHaveURL(/\/insights$/);
});
