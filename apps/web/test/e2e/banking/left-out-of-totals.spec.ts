import type {Locator, Page} from '@playwright/test';

import {
  BULK_CATEGORY_USER_AUTH_FILE,
  LEFT_OUT_USER_AUTH_FILE,
} from '../../constants/auth.constants';
import {API_URL, APP_ORIGIN_HEADERS, expect, test} from '../../fixtures';

// Synthetic transactions seeded by the API's leave-out seed (scripts/seed-data/seed-left-out-data.ts).
const CAFE = '00000000-0000-4000-8000-000000000501';
const BOOKSHOP = '00000000-0000-4000-8000-000000000502';
const MARKET = '00000000-0000-4000-8000-000000000503';

/** Counts every seeded payment in totals again, so every attempt starts from the seed. */
async function restoreSeed(page: Page) {
  const response = await page.request.patch(
    `${API_URL}/bank-transactions/bulk-left-out-of-totals`,
    {
      data: {transactionIds: [CAFE, BOOKSHOP, MARKET], leftOutOfTotals: false},
      headers: APP_ORIGIN_HEADERS,
    },
  );
  expect(response.status()).toBe(200);
}

/** What a card reads, one space between its lines. */
const textOf = (locator: Locator) =>
  locator.evaluate((element: HTMLElement) => element.innerText.replace(/\s+/g, ' ').trim());
const row = (page: Page, id: string) => page.getByTestId(`bank-transaction-row-${id}`);
// The row shows one marker at a time: on its second line, narrow or wide.
const marker = (page: Page, id: string) =>
  row(page, id).getByTestId('ledger-row-left-out').filter({visible: true});

test.describe('leave out of totals', () => {
  test.use({storageState: LEFT_OUT_USER_AUTH_FILE});

  test.beforeEach(async ({page}) => restoreSeed(page));

  test('leaves a row out from its details and two from the bulk bar, marks them, drops the totals, and counts them again', async ({
    page,
  }) => {
    await page.setViewportSize({width: 1440, height: 900});
    await page.goto('/transactions');
    const totals = page.getByTestId('bank-transactions-view-totals');
    await expect.poll(() => textOf(totals)).toContain('Spent €39.90');
    await expect.poll(() => textOf(totals)).toContain('Income +€1,500.00');
    await expect(page.getByTestId('ledger-row-left-out')).toHaveCount(0);

    // One row, from its details in the rail.
    await row(page, CAFE)
      .getByRole('button', {name: 'View Example Cafe transaction details'})
      .click();
    const details = page.getByTestId('bank-transaction-inspector');
    const leaveOut = details.getByRole('switch', {name: 'Leave out of totals'});
    await expect(leaveOut).not.toBeChecked();
    await leaveOut.click();
    await expect(leaveOut).toBeChecked();
    await expect(details.getByTestId('left-out-setting')).toContainText(
      'Counted in no total. Your balance keeps it.',
    );
    await expect(marker(page, CAFE)).toHaveText('Left out of totals');
    await expect(row(page, CAFE).getByTestId('ledger-row-amount')).toHaveCSS(
      'text-decoration-line',
      'line-through',
    );
    await details.getByRole('button', {name: 'Close transaction details'}).click();
    await expect.poll(() => textOf(totals)).toContain('Spent €35.40');

    // Two more, from the bulk bar.
    await row(page, BOOKSHOP).getByRole('checkbox', {name: 'Select Example Bookshop'}).click();
    await row(page, MARKET).getByRole('checkbox', {name: 'Select Example Market'}).click();
    const bar = page.getByRole('toolbar', {name: 'Selected transactions'});
    await expect(bar).toContainText('2 selected');
    await bar.getByRole('button', {name: 'Leave out'}).click();
    await expect(page.getByText('2 left out of totals')).toBeVisible();
    await expect(bar).toBeHidden();
    await expect(marker(page, BOOKSHOP)).toBeVisible();
    await expect(marker(page, MARKET)).toBeVisible();
    await expect.poll(() => textOf(totals)).toContain('Spent €0.00');
    await expect.poll(() => textOf(totals)).toContain('Income +€1,500.00');

    // Picked rows that are all left out are counted again by the same bar.
    for (const [id, name] of [
      [CAFE, 'Example Cafe'],
      [BOOKSHOP, 'Example Bookshop'],
      [MARKET, 'Example Market'],
    ]) {
      await row(page, id)
        .getByRole('checkbox', {name: `Select ${name}`})
        .click();
    }
    await bar.getByRole('button', {name: 'Count in totals'}).click();
    await expect(page.getByText('3 counted in totals again')).toBeVisible();
    await expect(page.getByTestId('ledger-row-left-out')).toHaveCount(0);
    await expect.poll(() => textOf(totals)).toContain('Spent €39.90');
  });
});

// The bulk category seed's Example Bookshop rows: more than the list loads at once.
const BOOKSHOP_COUNT = 55;

test.describe('leave out every matching row', () => {
  test.use({storageState: BULK_CATEGORY_USER_AUTH_FILE});

  // Counts every Example Bookshop row in totals again, so every attempt starts from the seed.
  test.beforeEach(async ({page}) => {
    const response = await page.request.patch(
      `${API_URL}/bank-transactions/bulk-left-out-of-totals`,
      {
        data: {filter: {search: 'Example Bookshop'}, leftOutOfTotals: false},
        headers: APP_ORIGIN_HEADERS,
      },
    );
    expect(response.status()).toBe(200);
  });

  test('leaves every matching row out from the bulk bar, then offers to count them all again', async ({
    page,
  }) => {
    await page.setViewportSize({width: 1440, height: 900});
    await page.goto('/transactions?search=Example%20Bookshop');
    const count = page.getByTestId('ledger-selection-count');
    const markers = page.getByTestId('ledger-row-left-out').filter({visible: true});
    await expect(count).toHaveText('Select all 50');
    await expect(markers).toHaveCount(0);

    await page.getByRole('checkbox', {name: 'Select all 50'}).click();
    await page.getByRole('button', {name: `Select all ${BOOKSHOP_COUNT} matching`}).click();
    const bar = page.getByRole('toolbar', {name: 'Selected transactions'});
    await expect(bar).toContainText(`${BOOKSHOP_COUNT} selected`);
    await bar.getByRole('button', {name: 'Leave out'}).click();
    await expect(page.getByText(`${BOOKSHOP_COUNT} left out of totals`)).toBeVisible();
    await expect(bar).toBeHidden();
    await expect(markers).toHaveCount(50);

    // Every matching row is left out now, so the same selection counts them in totals again.
    await page.getByRole('checkbox', {name: 'Select all 50'}).click();
    await page.getByRole('button', {name: `Select all ${BOOKSHOP_COUNT} matching`}).click();
    await bar.getByRole('button', {name: 'Count in totals'}).click();
    await expect(page.getByText(`${BOOKSHOP_COUNT} counted in totals again`)).toBeVisible();
    await expect(markers).toHaveCount(0);
  });
});
