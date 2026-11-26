import {BANK_TRANSACTION_CATEGORIES, type BankTransactionBreakdown} from '@tempo/contracts';

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
      by: 'category',
      periods: [
        {
          start: '2025-01-01',
          end: '2025-12-31',
          complete: true,
          total: '1450.00',
          parts: [
            part('GROCERIES', '1200.00', 41),
            part('SHOPPING', '300.00', 3),
            part('REFUND', '-50.00', 2),
          ],
        },
        {
          start: '2026-01-01',
          end: params.get('to')!,
          complete: false,
          total: '420.00',
          parts: [part('GROCERIES', '400.00', 1240), part('UNCATEGORIZED', '20.00', 1)],
        },
      ],
    } satisfies BankTransactionBreakdown);
  });

  await page.goto('/settings/categories');
  const list = page.getByRole('list', {name: 'All categories'});
  const count = (label: string) => list.getByRole('listitem').filter({hasText: label});

  await expect(count('Groceries')).toHaveText(/1,281$/);
  await expect(count('Shopping')).toHaveText(/3$/);
  await expect(count('Refund')).toHaveText(/2$/);
  // A category with no transactions still shows, counted as none.
  await expect(count('Education')).toHaveText(/0$/);
  // Rows without a category are listed after the categories while there are any.
  await expect(list.getByRole('listitem').last()).toHaveText(/^Not categorized\s*1$/);
  await expect(list.getByRole('listitem')).toHaveCount(BANK_TRANSACTION_CATEGORIES.length + 1);

  // The whole history, by year, as Home reads it.
  const [params] = requests;
  expect(Object.fromEntries(params)).toMatchObject({interval: 'year', by: 'category'});
  expect(params.get('to')).toBe(params.get('asOf'));
  expect(Number(params.get('to')!.slice(0, 4)) - Number(params.get('from')!.slice(0, 4))).toBe(19);
});
