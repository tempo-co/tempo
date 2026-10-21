import type {Page} from '@playwright/test';

import {
  BankTransaction,
  BankTransactionCategoryImpact,
  BankTransactionDirection,
} from '../../../src/features/banking/types/bank-transaction';
import {expect, test} from '../../fixtures';
import {fulfillJson, mockBankConnections, mockJson} from '../../utils/api-mocks';
import {expectNoHorizontalOverflow} from '../../utils/layout';

const ID = '00000000-0000-4000-8000-000000000201';
const FIRST_ID = '00000000-0000-4000-8000-000000000202';
const SECOND_ID = '00000000-0000-4000-8000-000000000203';
const transaction: BankTransaction = {
  id: ID,
  displayDescription: 'Example Shop',
  description: 'Example Shop',
  counterpartyName: 'Example Shop',
  transactionDate: '2026-09-10',
  bookingDate: '2026-09-11',
  valueDate: '2026-09-11',
  amount: '-10.00',
  currency: 'EUR',
  creditDebitIndicator: 'DBIT',
  direction: BankTransactionDirection.EXPENSE,
  transactionType: 'CARD_PAYMENT',
  transactionStatus: 'BOOK',
  providerTransactionDescription: null,
  merchantCategoryCode: null,
  remittanceInformation: null,
  balanceAfterAmount: null,
  balanceAfterCurrency: null,
  instructedAmount: null,
  instructedCurrency: null,
  exchangeRate: null,
  exchangeRateUnitCurrency: null,
  exchangeRateType: null,
  referenceNumber: null,
  referenceNumberScheme: null,
  bankName: 'Example Bank',
  bankCountry: 'NL',
  bankAccountName: 'Example account',
  bankAccountAlias: null,
  category: null,
  categoryStatus: 'PENDING',
  categorySource: null,
  categoryConfidence: null,
  financialEventType: null,
  financialEventSource: null,
  financialEventRuleVersion: null,
  cashFlowTreatment: 'EXPENSE',
};

const impact: BankTransactionCategoryImpact = {
  action: 'APPLY',
  category: 'TRAVEL',
  total: 2,
  transactions: [FIRST_ID, SECOND_ID].map((id, index) => ({
    id,
    displayDescription: `Example Shop ${index + 1}`,
    transactionDate: `2026-09-0${9 - index}`,
    bookingDate: null,
    amount: '-12.00',
    currency: 'EUR',
    category: 'SHOPPING',
    categorySource: 'AI',
    categoryStatus: 'COMPLETED',
  })),
};

async function mockCorrection(page: Page, preview: BankTransactionCategoryImpact = impact) {
  const state = {
    saved: {...transaction},
    writes: [] as Array<{
      category: NonNullable<BankTransaction['category']>;
      applyToTransactionIds: string[];
    }>,
    previewStatus: 200,
    saveStatus: 200,
  };
  await mockJson(page, '**/accounts/me', {
    id: '00000000-0000-4000-8000-000000000200',
    name: 'Alex Example',
    email: 'user@example.com',
    isEmailVerified: true,
  });
  await mockBankConnections(page, () => []);
  await page.route('**/bank-transactions?**', (route) => {
    if (!['fetch', 'xhr'].includes(route.request().resourceType())) return route.continue();
    return fulfillJson(route, {transactions: [state.saved], total: 1});
  });
  await page.route(`**/bank-transactions/${ID}`, (route) => fulfillJson(route, state.saved));
  await page.route(`**/bank-transactions/${ID}/category-impact?**`, (route) => {
    expect(new URL(route.request().url()).searchParams.get('category')).toBe('TRAVEL');
    return fulfillJson(route, state.previewStatus === 200 ? preview : {}, state.previewStatus);
  });
  await page.route(`**/bank-transactions/${ID}/category`, (route) => {
    const body = route.request().postDataJSON() as (typeof state.writes)[number];
    state.writes.push(body);
    if (state.saveStatus !== 200) return fulfillJson(route, {}, state.saveStatus);
    state.saved = {
      ...state.saved,
      category: body.category,
      categoryStatus: 'COMPLETED',
      categorySource: 'MANUAL',
    };
    return fulfillJson(route, state.saved);
  });
  await page.goto(`/bank-transactions?transactionId=${ID}`);
  await expect(page.getByTestId('bank-transaction-inspector')).toBeVisible();
  return state;
}

const PREVIEW_FAILED =
  'Category changes could not be previewed. Nothing was saved. Please try again.';
const categorySelect = (page: Page) => page.getByRole('combobox', {name: 'Transaction category'});
const impactDialog = (page: Page) => page.getByRole('dialog', {name: 'Update other transactions?'});

async function chooseTravel(page: Page) {
  await categorySelect(page).click();
  await page.getByRole('option', {name: 'Travel', exact: true}).click();
}

/** Holds the preview until the returned function is called, then answers with `body`. */
async function holdPreview(page: Page, body: unknown) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/bank-transactions/${ID}/category-impact?**`, async (route) => {
    await held;
    await fulfillJson(route, body);
  });
  return release;
}

/** Holds the save until the returned function is called, then lets the mocked save answer. */
async function holdSave(page: Page) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/bank-transactions/${ID}/category`, async (route) => {
    await held;
    await route.fallback();
  });
  return release;
}

for (const viewport of [
  {width: 1280, height: 800},
  {width: 390, height: 844},
]) {
  test.describe(`category correction at ${viewport.width}px`, () => {
    test.use({viewport, storageState: {cookies: [], origins: []}});

    test('previews before saving, defaults to all selected, and applies only ticked rows', async ({
      page,
    }, testInfo) => {
      const state = await mockCorrection(page);
      await chooseTravel(page);
      const dialog = impactDialog(page);
      await expect(dialog).toBeVisible();
      expect(state.writes).toEqual([]);
      await expect(dialog.getByRole('checkbox')).toHaveCount(2);
      await expect(dialog.getByRole('checkbox').nth(0)).toBeChecked();
      await expect(dialog.getByRole('checkbox').nth(1)).toBeChecked();
      await expect(dialog).toContainText('Sep 9, 2026');
      await expect(dialog).toContainText('€12.00');
      await expect(dialog).toContainText('Shopping → Travel');
      await expectNoHorizontalOverflow(page);
      await testInfo.attach('category-impact', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
      await dialog.getByRole('checkbox').nth(1).uncheck();
      await dialog.getByRole('button', {name: 'Update selected (1)', exact: true}).click();
      await expect(dialog).toBeHidden();
      expect(state.writes).toEqual([{category: 'TRAVEL', applyToTransactionIds: [FIRST_ID]}]);
      await expect(categorySelect(page)).toHaveText('Travel');
    });

    for (const dismissal of ['Cancel', 'Escape']) {
      test(`${dismissal} preserves an uncategorized transaction and its inspector`, async ({
        page,
      }) => {
        const state = await mockCorrection(page);
        await chooseTravel(page);
        const dialog = impactDialog(page);
        await expect(dialog).toBeVisible();
        if (dismissal === 'Cancel')
          await dialog.getByRole('button', {name: 'Cancel', exact: true}).click();
        else await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(page.getByTestId('bank-transaction-inspector')).toBeVisible();
        await expect(categorySelect(page)).toHaveText('Not categorized');
        expect(state.writes).toEqual([]);
        // A cancelled selection is not held locally: a fresh correction starts with all ticked again.
        await chooseTravel(page);
        await expect(dialog.getByRole('checkbox').nth(1)).toBeChecked();
      });
    }

    test('Just this one sends an empty selection', async ({page}) => {
      const state = await mockCorrection(page);
      await chooseTravel(page);
      const dialog = impactDialog(page);
      await dialog.getByRole('button', {name: 'Just this one', exact: true}).click();
      await expect(dialog).toBeHidden();
      expect(state.writes).toEqual([{category: 'TRAVEL', applyToTransactionIds: []}]);
    });

    test('an empty preview saves straight away, showing Saving… and then the saved category', async ({
      page,
    }) => {
      const state = await mockCorrection(page, {
        action: null,
        category: null,
        transactions: [],
        total: 0,
      });
      const releaseSave = await holdSave(page);
      const status = page.getByTestId('bank-transaction-category-status');
      try {
        await chooseTravel(page);
        await expect(status).toHaveText('Saving…');
        await expect(categorySelect(page)).toBeDisabled();
        await expect(page.getByTestId('category-impact-dialog')).toHaveCount(0);
      } finally {
        releaseSave();
      }
      await expect(categorySelect(page)).toHaveText('Travel');
      await expect(status).toHaveText('Categorized · Manual');
      expect(state.writes).toEqual([{category: 'TRAVEL', applyToTransactionIds: []}]);
    });

    test('previews AI rechecks, including the capped-result notice', async ({page}) => {
      const state = await mockCorrection(page, {
        ...impact,
        action: 'RECHECK',
        category: null,
        total: 600,
      });
      await chooseTravel(page);
      const dialog = impactDialog(page);
      await expect(dialog).toContainText('Showing the newest 2 of 600 matches');
      await expect(
        dialog.getByText('Shopping → Will be re-checked by AI', {exact: true}),
      ).toHaveCount(2);
      await dialog.getByRole('button', {name: 'Update selected (2)', exact: true}).click();
      await expect(dialog).toBeHidden();
      expect(state.writes).toEqual([
        {category: 'TRAVEL', applyToTransactionIds: [FIRST_ID, SECOND_ID]},
      ]);
    });

    test('does not save after a preview failure', async ({page}) => {
      const state = await mockCorrection(page);
      state.previewStatus = 429;
      await chooseTravel(page);
      await expect(page.getByText(PREVIEW_FAILED)).toBeVisible();
      await expect(categorySelect(page)).toHaveText('Not categorized');
      expect(state.writes).toEqual([]);
    });

    test('an expired session during the preview signs out without saving', async ({page}) => {
      const state = await mockCorrection(page);
      state.previewStatus = 401;
      await chooseTravel(page);
      await expect(page.getByText('Your session has expired')).toBeVisible();
      await expect(page).toHaveURL(/\/login/);
      await expect(page.getByText(PREVIEW_FAILED)).toHaveCount(0);
      expect(state.writes).toEqual([]);
    });

    test('closing a pending preview neither saves later nor marks Tempo offline', async ({
      page,
    }) => {
      const state = await mockCorrection(page);
      await page.clock.install();
      await page.clock.resume();
      let healthReads = 0;
      await page.route('**/health', (route) => {
        healthReads++;
        return fulfillJson(route, {status: 'ok'});
      });
      const releasePreview = await holdPreview(page, {
        action: null,
        category: null,
        transactions: [],
        total: 0,
      });
      try {
        const requested = page.waitForRequest(`**/bank-transactions/${ID}/category-impact?**`);
        await chooseTravel(page);
        await requested;
        await page.getByRole('button', {name: 'Close transaction details'}).click();
        await expect(page.getByTestId('bank-transaction-inspector')).toBeHidden();
        // A false offline transition would show the banner and start a health probe after 10s.
        await page.clock.runFor(11_000);
        await expect(
          page.getByTitle('Tempo is unreachable. Changes cannot be saved until it reconnects.'),
        ).toHaveCount(0);
        expect(healthReads).toBe(0);
        const response = page.waitForResponse(`**/bank-transactions/${ID}/category-impact?**`);
        releasePreview();
        await response;
        await page.clock.runFor(100);
        expect(state.writes).toEqual([]);
      } finally {
        releasePreview();
      }
    });

    test('a stalled preview retains the normal read deadline and releases the selector', async ({
      page,
    }) => {
      test.setTimeout(30_000);
      const state = await mockCorrection(page);
      const releasePreview = await holdPreview(page, impact);
      try {
        await chooseTravel(page);
        await expect(page.getByTestId('bank-transaction-category-status')).toContainText(
          'Checking other transactions',
        );
        await expect(page.getByText(PREVIEW_FAILED)).toBeVisible({timeout: 20_000});
        await expect(categorySelect(page)).toBeEnabled();
        expect(state.writes).toEqual([]);
      } finally {
        releasePreview();
      }
    });

    test('retains the selection after a failed save so it can be retried', async ({page}) => {
      const state = await mockCorrection(page);
      state.saveStatus = 429;
      await chooseTravel(page);
      const dialog = impactDialog(page);
      await dialog.getByRole('checkbox').nth(1).uncheck();
      await dialog.getByRole('button', {name: 'Update selected (1)', exact: true}).click();
      await expect(
        page.getByText('Transaction category could not be saved. Please try again.'),
      ).toBeVisible();
      await expect(dialog.getByRole('checkbox').nth(1)).not.toBeChecked();
      state.saveStatus = 200;
      await dialog.getByRole('button', {name: 'Update selected (1)', exact: true}).click();
      await expect(dialog).toBeHidden();
      expect(state.writes).toEqual([
        {category: 'TRAVEL', applyToTransactionIds: [FIRST_ID]},
        {category: 'TRAVEL', applyToTransactionIds: [FIRST_ID]},
      ]);
    });
  });
}
