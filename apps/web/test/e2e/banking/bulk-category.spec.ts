import type {Page} from '@playwright/test';

import {BULK_CATEGORY_USER_AUTH_FILE} from '../../constants/auth.constants';
import {API_URL, APP_ORIGIN_HEADERS, expect, test} from '../../fixtures';
import {expectNoHorizontalOverflow} from '../../utils/layout';

// Synthetic transactions seeded by the API's bulk category seed (scripts/seed-data/seed-bulk-category-data.ts).
const CAFE_TO_CHECK = [
  '00000000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000000302',
  '00000000-0000-4000-8000-000000000303',
];
const CAFE_SHOPPING = [
  '00000000-0000-4000-8000-000000000306',
  '00000000-0000-4000-8000-000000000307',
];

// The seed's Example Bookshop rows: more than the list loads at once, all older than the rows above.
const BOOKSHOP_COUNT = 55;

/** Puts the three cafe rows back in To check and the bookshop rows in Shopping, so every attempt starts from the seed. */
async function restoreSeed(page: Page) {
  for (const id of CAFE_TO_CHECK) {
    const response = await page.request.patch(`${API_URL}/bank-transactions/${id}/category`, {
      data: {category: 'NEEDS_REVIEW'},
      headers: APP_ORIGIN_HEADERS,
    });
    expect(response.status()).toBe(200);
  }
  const response = await page.request.patch(`${API_URL}/bank-transactions/bulk-category`, {
    data: {filter: {search: 'Example Bookshop'}, category: 'SHOPPING', scope: 'SELECTED'},
    headers: APP_ORIGIN_HEADERS,
  });
  expect(response.status()).toBe(200);
}

const row = (page: Page, id: string) => page.getByTestId(`bank-transaction-row-${id}`);

test.describe('bulk category', () => {
  test.use({storageState: BULK_CATEGORY_USER_AUTH_FILE});

  test.beforeEach(async ({page}) => restoreSeed(page));

  test('selects a range on desktop, asks once which rows change, and updates the rows and To check', async ({
    page,
  }) => {
    await page.setViewportSize({width: 1440, height: 900});
    await page.goto('/transactions');
    const toCheckTab = page.getByRole('tab', {name: /To check/});
    await expect(toCheckTab).toHaveText('To check4');
    await expect(page.getByTestId('ledger-selection-count')).toHaveText('Select all 50');
    // Nothing picked: a row press still opens its details.
    await expect(
      row(page, CAFE_TO_CHECK[0]).getByRole('button', {
        name: 'View Example Cafe transaction details',
      }),
    ).toBeVisible();

    await row(page, CAFE_TO_CHECK[0]).getByRole('checkbox', {name: 'Select Example Cafe'}).click();
    await row(page, CAFE_TO_CHECK[2])
      .getByRole('checkbox', {name: 'Select Example Cafe'})
      .click({modifiers: ['Shift']});
    await expect(page.getByTestId('ledger-selection-count')).toHaveText('3 of 50 selected');
    for (const id of CAFE_TO_CHECK) {
      await expect(row(page, id).getByRole('checkbox')).toBeChecked();
    }

    const bar = page.getByRole('toolbar', {name: 'Selected transactions'});
    await expect(bar).toContainText('3 selected');
    // The step stands for the rows it was asked for: dropping one of them ends it.
    await bar.getByRole('button', {name: 'Category'}).click();
    await page.getByRole('menuitem', {name: 'Eating out'}).click();
    await expect(page.getByTestId('bulk-category-step')).toBeVisible();
    await row(page, CAFE_TO_CHECK[2]).getByRole('checkbox').click();
    await expect(page.getByTestId('bulk-category-step')).toBeHidden();
    await expect(bar).toContainText('2 selected');
    await row(page, CAFE_TO_CHECK[2]).getByRole('checkbox').click();
    await bar.getByRole('button', {name: 'Category'}).click();
    await page.getByRole('menuitem', {name: 'Eating out'}).click();

    const rail = page.getByRole('complementary', {name: 'Change category'});
    const step = rail.getByTestId('bulk-category-step');
    await expect(step.getByRole('heading')).toHaveText('Change 3 to Eating out?');
    await expect(step).toContainText('2 more from Example Cafe can change too:');
    const others = step.getByRole('list', {name: 'Other transactions from these payees'});
    await expect(others.getByRole('listitem')).toHaveCount(2);
    await expect(others.getByRole('listitem').first()).toContainText('Shopping');
    await expect(step.getByRole('button', {name: 'Change all 5'})).toBeVisible();

    await step.getByRole('button', {name: 'Just these 3'}).click();
    await expect(page.getByText('Changed 3 to Eating out')).toBeVisible();
    await expect(step).toBeHidden();
    await expect(bar).toBeHidden();
    await expect(toCheckTab).toHaveText('To check1');
    for (const id of CAFE_TO_CHECK) {
      await expect(row(page, id).getByTestId('ledger-row-category')).toHaveText('Eating out');
    }
    for (const id of CAFE_SHOPPING) {
      await expect(row(page, id).getByTestId('ledger-row-category')).toHaveText('Shopping');
    }
    await expect(page.getByTestId('ledger-selection-count')).toHaveText('Select all 50');
  });

  test('selects every row the filters match, past the loaded ones, and changes them in one write', async ({
    page,
  }) => {
    await page.setViewportSize({width: 1440, height: 900});
    await page.goto('/transactions?search=Example%20Bookshop');
    const count = page.getByTestId('ledger-selection-count');
    await expect(count).toHaveText('Select all 50');
    // Matching rows are offered once every loaded row is picked.
    await expect(page.getByRole('button', {name: /matching/})).toHaveCount(0);

    await page.getByRole('checkbox', {name: 'Select all 50'}).click();
    await expect(count).toHaveText('50 of 50 selected');
    await page.getByRole('button', {name: `Select all ${BOOKSHOP_COUNT} matching`}).click();
    await expect(count).toHaveText(`All ${BOOKSHOP_COUNT} selected`);
    const bar = page.getByRole('toolbar', {name: 'Selected transactions'});
    await expect(bar).toContainText(`${BOOKSHOP_COUNT} selected`);
    // Rows loaded later are picked too.
    await page.getByRole('button', {name: 'Load more'}).click();
    const checkboxes = page.getByRole('checkbox', {name: 'Select Example Bookshop'});
    await expect(checkboxes).toHaveCount(BOOKSHOP_COUNT);
    for (const checkbox of await checkboxes.all()) await expect(checkbox).toBeChecked();

    await bar.getByRole('button', {name: 'Category'}).click();
    await page.getByRole('menuitem', {name: 'Entertainment'}).click();
    const step = page
      .getByRole('complementary', {name: 'Change category'})
      .getByTestId('bulk-category-step');
    await expect(step.getByRole('heading')).toHaveText(
      `Change ${BOOKSHOP_COUNT} to Entertainment?`,
    );
    await expect(step).toContainText('No other transactions from these payees.');
    await step.getByRole('button', {name: `Change ${BOOKSHOP_COUNT}`}).click();

    await expect(page.getByText(`Changed ${BOOKSHOP_COUNT} to Entertainment`)).toBeVisible();
    await expect(bar).toBeHidden();
    await expect(page.getByTestId('ledger-row-category')).toHaveText(
      Array.from({length: BOOKSHOP_COUNT}, () => 'Entertainment'),
    );
  });

  test('on a phone, Select mode picks rows and the category comes from a bottom sheet', async ({
    page,
  }) => {
    await page.setViewportSize({width: 390, height: 844});
    await page.goto('/transactions');
    const toCheckTab = page.getByRole('tab', {name: /To check/});
    await expect(toCheckTab).toHaveText('To check4');
    // No checkboxes until Select is pressed.
    await expect(page.getByRole('checkbox')).toHaveCount(0);

    await page.getByRole('button', {name: 'Select'}).click();
    for (const id of CAFE_TO_CHECK) {
      await row(page, id).getByRole('button', {name: 'Select Example Cafe'}).click();
    }
    await expect(page.getByTestId('ledger-selection-count')).toHaveText('3 of 50 selected');
    const bar = page.getByRole('toolbar', {name: 'Selected transactions'});
    await expect(bar).toContainText('3 selected');
    await expectNoHorizontalOverflow(page);

    await bar.getByRole('button', {name: 'Category'}).click();
    const sheet = page.getByTestId('bulk-category-sheet');
    await expect(sheet.getByRole('heading')).toHaveText('Category for 3');
    await sheet.getByRole('button', {name: 'Eating out'}).click();

    const step = page.getByRole('dialog').getByTestId('bulk-category-step');
    await expect(step.getByRole('heading')).toHaveText('Change 3 to Eating out?');
    await expect(step.getByRole('button', {name: 'Change all 5'})).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await step.getByRole('button', {name: 'Just these 3'}).click();

    await expect(page.getByText('Changed 3 to Eating out')).toBeVisible();
    await expect(toCheckTab).toHaveText('To check1');
    await expect(row(page, CAFE_TO_CHECK[1])).toContainText('Eating out');
    // Done: Select mode ends with the write.
    await expect(page.getByRole('checkbox')).toHaveCount(0);
  });
});
