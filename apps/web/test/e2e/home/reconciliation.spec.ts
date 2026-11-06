import type {BankTransactionBreakdown, BankTransactionReviewCounts} from '@tempo/contracts';

import {VERIFIED_USER_AUTH_FILE} from '../../constants/auth.constants';
import {SEEDED_TRANSACTION_YEAR_NOW} from '../../constants/seed.constants';
import {API_URL, expect, test} from '../../fixtures';

test.use({storageState: VERIFIED_USER_AUTH_FILE, timezoneId: 'Europe/Amsterdam'});

test('a real category total in a month reconciles with its transaction drill', async ({page}) => {
  await page.clock.setFixedTime(SEEDED_TRANSACTION_YEAR_NOW);
  const response = await page.request.get(
    `${API_URL}/bank-transactions/breakdown?interval=month&by=category&from=2026-08-01&to=2026-08-31&asOf=2026-10-01`,
  );
  expect(response.ok()).toBe(true);
  const breakdown = (await response.json()) as BankTransactionBreakdown;
  const part = breakdown.periods[0]?.parts.find((item) => item.key === 'UNCATEGORIZED');
  if (!part) throw new Error('Missing seeded uncategorized spending');
  const spendingCents = Math.round(Number(part.amount) * 100);
  expect(spendingCents).toBeGreaterThan(0);
  const counts = (await (
    await page.request.get(`${API_URL}/bank-transactions/review-counts`)
  ).json()) as BankTransactionReviewCounts;

  await page.goto('/?month=2026-08');
  const row = page
    .getByRole('dialog', {name: 'August 2026'})
    .getByRole('region', {name: 'Where it went'})
    .getByRole('link', {name: /Uncategorized/});
  await expect(row).toContainText(
    new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: breakdown.baseCurrency!,
      maximumFractionDigits: 0,
    }).format(Number(part.amount)),
  );
  await row.click();
  const search = new URL(page.url()).searchParams;
  expect(JSON.parse(search.get('categories')!)).toEqual(['UNCATEGORIZED']);
  // The link applies exactly the filters behind the total, so its list holds exactly the counted rows.
  expect(JSON.parse(search.get('cashFlows')!)).toEqual(['SPENDING']);
  expect(search.get('baseAmount')).toBe(counts.missingBaseAmount > 0 ? 'PRESENT' : null);
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
  expect(
    list.transactions.reduce(
      (sum, item) => sum - Math.round(Number(item.amountInBaseCurrency) * 100),
      0,
    ),
  ).toBe(spendingCents);
  const countLabel = `${list.total} ${list.total === 1 ? 'transaction' : 'transactions'}`;
  await expect(page.getByRole('heading', {name: 'Bank transactions'}).locator('..')).toContainText(
    countLabel,
  );
});
