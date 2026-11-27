import {BANK_TRANSACTION_CATEGORIES, type BankTransactionBreakdown} from '@wisp/contracts';

import {createAccount} from '../../data/account.data';
import {expect, test} from '../../fixtures';
import {fulfillJson, mockJson} from '../../utils/api-mocks';

test.use({storageState: {cookies: [], origins: []}});

const part = (key: string, amount: string, count: number) => ({key, label: key, amount, count});

test('Categories lists every category with the transactions the breakdown counts in it', async ({
  page,
}) => {
  await mockJson(page, '**/accounts/me', createAccount());
  const requests: URLSearchParams[] = [];
  await page.route('**/bank-transactions/breakdown?**', (route) => {
    const params = new URL(route.request().url()).searchParams;
    requests.push(params);
    return fulfillJson(route, {
      baseCurrency: 'EUR',
      interval: 'year',
      by: 'allCategories',
      periods: [
        {
          start: '2025-01-01',
          end: '2025-12-31',
          complete: true,
          total: '28800.00',
          parts: [
            part('INCOME', '30000.00', 12),
            part('SHOPPING', '0.00', 2),
            part('GROCERIES', '-1200.00', 41),
          ],
        },
        {
          start: '2026-01-01',
          end: params.get('to')!,
          complete: false,
          total: '2080.00',
          parts: [
            part('INCOME', '2500.00', 1),
            part('UNCATEGORIZED', '-20.00', 1),
            part('GROCERIES', '-400.00', 1240),
          ],
        },
      ],
    } satisfies BankTransactionBreakdown);
  });

  await page.goto('/settings/categories');
  const list = page.getByRole('list', {name: 'All categories'});
  const count = (label: string) => list.getByRole('listitem').filter({hasText: label});

  await expect(count('Groceries')).toHaveText(/1,281$/);
  // Income counts as any other category, and a category whose amounts cancel out still counts its rows.
  await expect(count('Income')).toHaveText(/13$/);
  await expect(count('Shopping')).toHaveText(/2$/);
  // A category with no transactions still shows, counted as none.
  await expect(count('Education')).toHaveText(/0$/);
  // Rows without a category are listed after the categories while there are any.
  await expect(list.getByRole('listitem').last()).toHaveText(/^Not categorized\s*1$/);
  await expect(list.getByRole('listitem')).toHaveCount(BANK_TRANSACTION_CATEGORIES.length + 1);

  // The whole history, by year, every category in either direction.
  const [params] = requests;
  expect(Object.fromEntries(params)).toMatchObject({interval: 'year', by: 'allCategories'});
  expect(params.get('to')).toBe(params.get('asOf'));
  expect(Number(params.get('to')!.slice(0, 4)) - Number(params.get('from')!.slice(0, 4))).toBe(19);
});
