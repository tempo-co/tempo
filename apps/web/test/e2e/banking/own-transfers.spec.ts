import type {Page} from '@playwright/test';

import {OWN_TRANSFER_USER_AUTH_FILE} from '../../constants/auth.constants';
import {expect, test} from '../../fixtures';
import {boxOf} from '../../utils/layout';

// Synthetic transactions seeded by the API's own-transfer seed (scripts/seed-data/seed-own-transfer-data.ts).
const IBAN_PAIR_OUTGOING_ID = '00000000-0000-4000-8000-000000000101';
const IBAN_PAIR_INCOMING_ID = '00000000-0000-4000-8000-000000000102';
const ONE_SIDED_ID = '00000000-0000-4000-8000-000000000105';
const COINCIDENCE_OUTGOING_ID = '00000000-0000-4000-8000-000000000106';

async function openDisclosure(page: Page, name: 'Bank details' | 'Transfer settings') {
  const inspector = page.getByTestId('bank-transaction-inspector');
  const disclosure = inspector.getByRole('button', {name, exact: true});
  await expect(disclosure).toBeVisible();
  if ((await disclosure.getAttribute('aria-expanded')) === 'false') await disclosure.click();
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  return inspector.locator(`[id="${await disclosure.getAttribute('aria-controls')}"]`);
}

/** Clears an override left by an earlier failed attempt, so every test starts from the seed. */
async function restoreAutomaticRecognition(page: Page, transactionId: string) {
  await page.goto(`/bank-transactions?transactionId=${transactionId}`);
  const settings = await openDisclosure(page, 'Transfer settings');
  await expect(settings.getByRole('button').first()).toBeVisible();
  const restore = settings.getByRole('button', {name: 'Use automatic recognition'});
  if (await restore.isVisible()) {
    await restore.click();
    await expect(restore).toBeHidden();
  }
}

test.describe('own transfers', () => {
  test.use({storageState: OWN_TRANSFER_USER_AUTH_FILE});

  test.beforeEach(async ({page}) => {
    for (const id of [IBAN_PAIR_OUTGOING_ID, IBAN_PAIR_INCOMING_ID, COINCIDENCE_OUTGOING_ID]) {
      await restoreAutomaticRecognition(page, id);
    }
  });

  test('labels recognized transfers, links the other side and filters them', async ({page}) => {
    await page.setViewportSize({width: 1280, height: 720});
    await page.goto('/bank-transactions');

    const ibanRow = page.getByTestId(`bank-transaction-row-${IBAN_PAIR_OUTGOING_ID}`);
    await expect(ibanRow.getByRole('cell').nth(2)).toContainText('Own transfer');
    await expect(ibanRow.getByRole('cell').nth(2)).toContainText('Internal movement');
    // The activity icon uses the same boxed tile as category icons, so labels line up; 20px keeps a
    // two-line category within the row height every transaction list shares.
    const activityTile = ibanRow
      .getByRole('cell')
      .nth(2)
      .locator('svg.lucide-refresh-cw')
      .locator('..');
    expect(await boxOf(activityTile)).toMatchObject({width: 20, height: 20});
    const coincidenceRow = page.getByTestId(`bank-transaction-row-${COINCIDENCE_OUTGOING_ID}`);
    await expect(coincidenceRow.getByRole('cell').nth(2)).not.toContainText('Own transfer');

    await page.goto(`/bank-transactions?transactionId=${IBAN_PAIR_OUTGOING_ID}`);
    const inspector = page.getByTestId('bank-transaction-inspector');
    const movement = inspector.getByRole('region', {name: 'Money movement'});
    await expect(movement.getByRole('heading', {name: 'Between your accounts'})).toBeVisible();
    await expect(movement).toContainText('Excluded from income and spending');
    await expect(inspector.getByRole('combobox', {name: 'Transaction category'})).toHaveCount(0);
    await expect(await openDisclosure(page, 'Bank details')).toContainText('Matched by IBAN');

    // The visible account and original amount name the link to the other side.
    const counterpartCard = movement.getByTestId('movement-counterpart');
    await expect(counterpartCard).toHaveAccessibleName(/€200\.00/);
    await expect(counterpartCard).toContainText('200');
    await expect
      .poll(() => counterpartCard.evaluate((element) => element.scrollWidth <= element.clientWidth))
      .toBe(true);
    await counterpartCard.click();
    await expect(page).toHaveURL(new RegExp(`transactionId=${IBAN_PAIR_INCOMING_ID}`));
    await expect(inspector.getByTestId('bank-transaction-detail-amount')).toContainText('200');
    await expect(await openDisclosure(page, 'Bank details')).toContainText('Matched by IBAN');

    await page.goto(`/bank-transactions?transactionId=${ONE_SIDED_ID}`);
    await expect(movement).toContainText('Other side not in your connected accounts');
    await inspector.getByRole('button', {name: 'Close transaction details'}).click();

    await page.getByRole('button', {name: 'Cash flow', exact: true}).click();
    await page.getByRole('option', {name: 'Own transfer', exact: true}).click();
    await expect(page.getByTestId(/^bank-transaction-row-/)).toHaveCount(5);
    await expect(page).toHaveURL(/OWN_TRANSFER/);
  });

  test('marks, unmarks and restores automatic recognition', async ({page}) => {
    // Several saves, each refetching the affected transactions.
    test.slow();
    // Every step ends on automatic recognition, so the test is retry-safe and leaves the seed as-is.
    await page.goto(`/bank-transactions?transactionId=${COINCIDENCE_OUTGOING_ID}`);
    const inspector = page.getByTestId('bank-transaction-inspector');
    let settings = await openDisclosure(page, 'Transfer settings');

    await settings.getByRole('button', {name: 'Mark as own transfer'}).click();
    await expect(await openDisclosure(page, 'Bank details')).toContainText('Marked by you');
    await expect(inspector.getByRole('region', {name: 'Money movement'})).toContainText(
      'Excluded from income and spending',
    );

    await settings.getByRole('button', {name: 'Use automatic recognition'}).click();
    await expect(settings.getByRole('button', {name: 'Mark as own transfer'})).toBeVisible();
    await expect(inspector.getByRole('combobox', {name: 'Transaction category'})).toBeVisible();

    await page.goto(`/bank-transactions?transactionId=${IBAN_PAIR_OUTGOING_ID}`);
    settings = await openDisclosure(page, 'Transfer settings');
    await settings.getByRole('button', {name: 'Not my own transfer'}).click();
    await expect(settings.getByRole('button', {name: 'Mark as own transfer'})).toBeVisible();
    // The other leg keeps its own name evidence, and the toast says so.
    await expect(
      page.getByText(
        'Unmarked. The other side is still an own transfer; unmark it too if neither is.',
      ),
    ).toBeVisible();

    // Unmarking one leg unpairs the other; it keeps its own evidence and stays undoable on its own.
    await page.goto(`/bank-transactions?transactionId=${IBAN_PAIR_INCOMING_ID}`);
    await expect(await openDisclosure(page, 'Bank details')).toContainText(
      'Matched by account holder name',
    );
    await expect(inspector.getByRole('region', {name: 'Money movement'})).toContainText(
      'Other side not in your connected accounts',
    );

    await page.goto(`/bank-transactions?transactionId=${IBAN_PAIR_OUTGOING_ID}`);
    settings = await openDisclosure(page, 'Transfer settings');
    await settings.getByRole('button', {name: 'Use automatic recognition'}).click();
    await expect(await openDisclosure(page, 'Bank details')).toContainText('Matched by IBAN');
  });

  test('shows own transfers on mobile', async ({page}) => {
    await page.setViewportSize({width: 393, height: 852});
    await page.goto(`/bank-transactions?transactionId=${IBAN_PAIR_OUTGOING_ID}`);
    await expect(await openDisclosure(page, 'Bank details')).toContainText('Matched by IBAN');
    await page.goto(`/bank-transactions?transactionId=${ONE_SIDED_ID}`);
    const movement = page.getByRole('region', {name: 'Money movement'});
    const oneSided = movement.getByText('Other side not in your connected accounts');
    await expect(oneSided).toBeVisible();
    await expect
      .poll(() => oneSided.evaluate((element) => element.scrollWidth <= element.clientWidth))
      .toBe(true);
    expect((await boxOf(movement)).width).toBeLessThanOrEqual(393);
    await page.keyboard.press('Escape');
    await expect(
      page
        .getByTestId(`bank-transaction-row-${IBAN_PAIR_OUTGOING_ID}`)
        .getByTestId('bank-transaction-mobile-meta'),
    ).toContainText('Own transfer');
  });
});
