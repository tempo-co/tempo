import {VERIFIED_USER_AUTH_FILE} from '../../constants/auth.constants';
import {SEEDED_TRANSACTION_YEAR_NOW} from '../../constants/seed.constants';
import {firstMonthSummary, septemberSummary} from '../../data/home-summary.data';
import {expect, test} from '../../fixtures';
import {mockJson} from '../../utils/api-mocks';

test.use({storageState: VERIFIED_USER_AUTH_FILE});
test.beforeEach(async ({page}) => {
  await page.clock.setFixedTime(SEEDED_TRANSACTION_YEAR_NOW);
});

test('shows exact spending and an accessible pace alternative', async ({page}) => {
  await mockJson(page, '**/bank-transactions/summary**', septemberSummary);
  await page.goto('/?month=2026-09');
  const card = page.getByTestId('spending-summary');
  await expect(card.getByRole('link', {name: '€1,200.00', exact: true})).toBeVisible();
  const comparison = card.getByTestId('spending-comparison');
  await expect(comparison).toContainText('€150.00 less than usual');
  await expect(comparison).toContainText('Usual by the 30th: €1,350.00 · within range');
  await expect(card).not.toContainText('Usual is the average of');
  // The comparison sits beside the headline on wide screens instead of below it.
  const headline = await card.getByRole('link', {name: '€1,200.00', exact: true}).boundingBox();
  const side = await comparison.boundingBox();
  expect(side!.x).toBeGreaterThan(headline!.x + headline!.width);
  expect(side!.y).toBeLessThan(headline!.y + headline!.height);
  await expect(card).toContainText('Lowest to highest');
  const row = card
    .getByRole('table', {name: 'Exact daily spending', includeHidden: true})
    .getByRole('row', {includeHidden: true})
    .nth(18);
  await expect(row).toContainText('18 Sep');
  await expect(row).toContainText('€720.00');
  await expect(row).toContainText('€810.00');
  await row.getByRole('link', {includeHidden: true}).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/bank-transactions/);
  const search = new URL(page.url()).searchParams;
  expect(search.has('cashFlows')).toBe(false);
  expect(search.has('baseAmount')).toBe(false);
  await expect(page.getByTestId('bank-transaction-drill-filters')).toHaveCount(0);
});

test('explains missing history without inventing a range', async ({page}) => {
  await mockJson(page, '**/bank-transactions/summary**', firstMonthSummary);
  await page.goto('/?month=2026-09');
  const card = page.getByTestId('spending-summary');
  await expect(card).toContainText('No earlier months to compare with yet.');
  await expect(card.getByText('Lowest to highest')).toHaveCount(0);
});
