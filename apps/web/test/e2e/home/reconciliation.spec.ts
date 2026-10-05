import type {BankTransactionSummary} from '@/features/dashboard/types/bank-transaction-summary';

import {VERIFIED_USER_AUTH_FILE} from '../../constants/auth.constants';
import {API_URL, expect, test} from '../../fixtures';

test.use({storageState: VERIFIED_USER_AUTH_FILE});

for (const [flow, label, sign] of [
  ['SPENDING', 'spending', -1],
  ['INCOME', 'income', 1],
] as const) {
  test(`real ${label} total reconciles with its transaction drill`, async ({page}) => {
    const response = await page.request.get(
      `${API_URL}/bank-transactions/summary?month=2026-08&asOf=2026-10-04`,
    );
    const summary = (await response.json()) as BankTransactionSummary;
    const totalCents = Math.round(Number(summary.totals[label]) * 100);
    await page.goto('/?month=2026-08');
    const card = page.getByTestId('spending-summary');
    const link = card.getByRole('link', {
      name: new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: summary.baseCurrency!,
      }).format(Number(summary.totals[label])),
      exact: true,
    });
    const listRequest = page.waitForRequest(
      (request) =>
        request.url().includes('/bank-transactions?') &&
        request.url().includes(`filter%5BcashFlows%5D%5B%5D=${flow}`),
    );
    await link.first().click();
    // Re-request every row the list asked for, so the sum covers all pages.
    const url = new URL((await listRequest).url());
    url.searchParams.set('pagination[pageIndex]', '0');
    url.searchParams.set('pagination[pageSize]', '100');
    const list = (await (await page.request.get(url.toString())).json()) as {
      total: number;
      transactions: {amountInBaseCurrency: string | null}[];
    };
    expect(list.total).toBeLessThanOrEqual(100);
    expect(
      list.transactions.reduce(
        (sum, row) => sum + sign * Math.round(Number(row.amountInBaseCurrency) * 100),
        0,
      ),
    ).toBe(totalCents);
  });
}

test('real category count and amount reconcile with its transaction drill', async ({page}) => {
  const response = await page.request.get(
    `${API_URL}/bank-transactions/summary?month=2026-08&asOf=2026-10-04`,
  );
  expect(response.ok()).toBe(true);
  const summary = (await response.json()) as BankTransactionSummary;
  const category = summary.categories.find(
    (row: {category: string}) => row.category === 'UNCATEGORIZED',
  );
  if (!category) throw new Error('Missing seeded uncategorized spending');
  expect(category.count).toBeGreaterThan(0);
  const spendingCents = Math.round(Number(category.spending) * 100);
  expect(spendingCents).toBeGreaterThan(0);
  await page.goto('/?month=2026-08');
  const row = page.getByTestId('category-breakdown').getByRole('link', {name: /Uncategorized/});
  await expect(row).toContainText(
    new Intl.NumberFormat(undefined, {style: 'currency', currency: summary.baseCurrency!}).format(
      Number(category.spending),
    ),
  );
  await expect(row).toContainText(`${category.count} transactions`);
  await row.click();
  const search = new URL(page.url()).searchParams;
  expect(JSON.parse(search.get('categories')!)).toEqual(['UNCATEGORIZED']);
  // The link applies exactly the filters behind the total, so its list holds exactly the counted rows.
  expect(JSON.parse(search.get('cashFlows')!)).toEqual(['SPENDING']);
  expect(search.get('baseAmount')).toBe(summary.excluded.missingBaseAmount > 0 ? 'PRESENT' : null);
  const params = new URLSearchParams({
    'filter[bookingDate][from]': '2026-08-01',
    'filter[bookingDate][to]': '2026-08-31',
    'filter[categories][]': 'UNCATEGORIZED',
    'filter[cashFlows][]': 'SPENDING',
    'filter[baseAmount]': 'PRESENT',
    'pagination[pageSize]': '100',
  });
  const listResponse = await page.request.get(`${API_URL}/bank-transactions?${params}`);
  expect(listResponse.ok()).toBe(true);
  const list = (await listResponse.json()) as {
    total: number;
    transactions: {amountInBaseCurrency: string | null}[];
  };
  expect(list.total).toBe(category.count);
  expect(
    list.transactions.reduce(
      (sum, row) => sum - Math.round(Number(row.amountInBaseCurrency) * 100),
      0,
    ),
  ).toBe(spendingCents);
  const countLabel = `${category.count} ${category.count === 1 ? 'transaction' : 'transactions'}`;
  await expect(page.getByRole('heading', {name: 'Bank transactions'}).locator('..')).toContainText(
    countLabel,
  );
});
