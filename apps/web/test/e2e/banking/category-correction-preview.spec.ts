import type {Page} from '@playwright/test';
import {BankTransaction, BankTransactionCategoryImpact} from '@wisp/contracts';

import {createAccount} from '../../data/account.data';
import {createBankTransaction} from '../../data/bank-transaction.data';
import {expect, test} from '../../fixtures';
import {fulfillJson, mockBankConnections, mockJson} from '../../utils/api-mocks';
import {animationsSettled, expectNoHorizontalOverflow} from '../../utils/layout';

const ID = '00000000-0000-4000-8000-000000000201';
const FIRST_ID = '00000000-0000-4000-8000-000000000202';
const SECOND_ID = '00000000-0000-4000-8000-000000000203';
const THIRD_ID = '00000000-0000-4000-8000-000000000204';
const transaction: BankTransaction = createBankTransaction({
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
  direction: 'EXPENSE',
  transactionType: 'CARD_PAYMENT',
  transactionStatus: 'BOOK',
  bankName: 'Example Bank',
  bankCountry: 'NL',
  bankAccountName: 'Example account',
  category: null,
  categoryStatus: 'PENDING',
  categorySource: null,
  categoryConfidence: null,
  cashFlowTreatment: 'EXPENSE',
});

const impact: BankTransactionCategoryImpact = {
  action: 'APPLY',
  category: 'TRAVEL',
  total: 3,
  transactions: [FIRST_ID, SECOND_ID, THIRD_ID].map((id, index) => ({
    id,
    displayDescription: 'Example Shop',
    transactionDate: `2026-09-0${9 - index}`,
    bookingDate: null,
    amount: '-12.00',
    currency: 'EUR',
    category: index === 1 ? 'EATING_OUT' : 'SHOPPING',
    categorySource: 'AI',
    categoryStatus: 'COMPLETED',
  })),
};

async function mockCorrection(
  page: Page,
  preview: BankTransactionCategoryImpact = impact,
  corrected: Partial<BankTransaction> = {},
) {
  const state = {
    saved: {...transaction, ...corrected},
    writes: [] as Array<{
      category: NonNullable<BankTransaction['category']>;
      applyToTransactionIds: string[];
    }>,
    previewStatus: 200,
    saveStatus: 200,
  };
  await mockJson(
    page,
    '**/accounts/me',
    createAccount({
      id: '00000000-0000-4000-8000-000000000200',
      name: 'Alex Example',
      email: 'user@example.com',
    }),
  );
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
  await page.goto(`/transactions?transactionId=${ID}`);
  await expect(page.getByTestId('bank-transaction-inspector')).toBeVisible();
  return state;
}

const PREVIEW_FAILED = 'Category changes could not be previewed. Nothing was saved. Try again.';
const categorySelect = (page: Page) => page.getByRole('combobox', {name: 'Transaction category'});
const impactStep = (page: Page) =>
  page.getByRole('region', {name: 'Move other Example Shop payments to Travel too?'});

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
  {width: 1440, height: 900},
  {width: 390, height: 844},
]) {
  test.describe(`category correction at ${viewport.width}px`, () => {
    test.use({viewport, storageState: {cookies: [], origins: []}});

    test('previews before saving, groups the other payments by the category they move from, and applies only ticked rows', async ({
      page,
    }, testInfo) => {
      const state = await mockCorrection(page);
      await chooseTravel(page);
      const step = impactStep(page);
      await expect(step).toBeVisible();
      expect(state.writes).toEqual([]);
      await expect(step).toContainText('This payment moves');
      await expect(step).toContainText('3 other Example Shop payments can follow:');
      const shopping = step.getByRole('checkbox', {name: 'Shopping to Travel', exact: true});
      const food = step.getByRole('checkbox', {name: 'Eating out to Travel', exact: true});
      await expect(shopping).toBeChecked();
      await expect(food).toBeChecked();
      // Each group's payments stay folded until its count is opened.
      await expect(step.getByRole('checkbox')).toHaveCount(2);
      await expect(step.getByRole('button', {name: 'Only this one', exact: true})).toBeVisible();
      const moveAll = step.getByRole('button', {name: 'Move all 3 to Travel', exact: true});
      await expect(moveAll).toBeVisible();
      const shoppingRows = step.getByRole('button', {name: '2 Shopping payments', exact: true});
      await expect(shoppingRows).toHaveAttribute('aria-expanded', 'false');
      await shoppingRows.click();
      await animationsSettled(step);
      await expect(shoppingRows).toHaveAttribute('aria-expanded', 'true');
      const first = step.getByRole('checkbox', {
        name: 'Example Shop, Sep 9, 2026, -€12.00',
        exact: true,
      });
      const third = step.getByRole('checkbox', {
        name: 'Example Shop, Sep 7, 2026, -€12.00',
        exact: true,
      });
      await expect(first).toBeChecked();
      await expect(third).toBeChecked();
      await expect(step).toContainText('€12.00');
      for (const icon of await step.getByTestId('category-icon').all()) {
        const box = await icon.boundingBox();
        expect([box!.width, box!.height]).toEqual([20, 20]);
      }
      if (page.viewportSize()!.width < 768) {
        const primary = await moveAll.boundingBox();
        const secondary = await step
          .getByRole('button', {name: 'Only this one', exact: true})
          .boundingBox();
        expect(primary!.y).toBeLessThan(secondary!.y);
      }
      const firstRow = await first.locator('xpath=ancestor::label[1]').boundingBox();
      expect(firstRow!.height).toBe(60);
      const tile = await step.getByTestId('merchant-logo-tile').first().boundingBox();
      expect([tile!.width, tile!.height]).toEqual([36, 36]);
      await expectNoHorizontalOverflow(page);
      await testInfo.attach('category-impact', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
      await third.uncheck();
      await expect(shopping).toHaveAttribute('aria-checked', 'mixed');
      await expect(shoppingRows).toHaveText('1 of 2 payments');
      await food.uncheck();
      // Holds the refresh that follows the save, while the step shows its pending state.
      let releaseRefresh!: () => void;
      const refreshHeld = new Promise<void>((resolve) => {
        releaseRefresh = resolve;
      });
      await page.route('**/bank-transactions?**', async (route) => {
        if (state.writes.length > 0) await refreshHeld;
        await route.fallback();
      });
      await step.getByRole('button', {name: 'Move 1 to Travel', exact: true}).click();
      try {
        await expect(step.getByRole('button', {name: 'Saving…'})).toBeVisible();
        // Escape while saving keeps the step and the details open.
        await page.keyboard.press('Escape');
        await expect(step.getByRole('button', {name: 'Saving…'})).toBeVisible();
        await expect.poll(() => state.writes.length).toBe(1);
        await expect(step.getByText('Not categorized', {exact: true})).toBeVisible();
      } finally {
        releaseRefresh();
      }
      await expect(step).toBeHidden();
      expect(state.writes).toEqual([{category: 'TRAVEL', applyToTransactionIds: [FIRST_ID]}]);
      await expect(categorySelect(page)).toHaveText('Travel');
    });

    for (const dismissal of ['Cancel', 'Escape']) {
      test(`${dismissal} preserves an uncategorized transaction and its inspector`, async ({
        page,
      }) => {
        const state = await mockCorrection(page);
        await chooseTravel(page);
        const step = impactStep(page);
        await expect(step).toBeVisible();
        if (dismissal === 'Cancel')
          await step.getByRole('button', {name: 'Cancel', exact: true}).click();
        else await page.keyboard.press('Escape');
        await expect(step).toBeHidden();
        await expect(page.getByTestId('bank-transaction-inspector')).toBeVisible();
        await expect(categorySelect(page)).toHaveText('Not categorized');
        expect(state.writes).toEqual([]);
        // A cancelled selection is not held locally: a fresh correction starts with all ticked again.
        await chooseTravel(page);
        await expect(
          step.getByRole('checkbox', {name: 'Eating out to Travel', exact: true}),
        ).toBeChecked();
      });
    }

    test('Only this one sends an empty selection', async ({page}) => {
      const state = await mockCorrection(page);
      await chooseTravel(page);
      const step = impactStep(page);
      await step.getByRole('button', {name: 'Only this one', exact: true}).click();
      await expect(step).toBeHidden();
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
        await expect(page.getByTestId('category-impact')).toHaveCount(0);
      } finally {
        releaseSave();
      }
      await expect(categorySelect(page)).toHaveText('Travel');
      await expect(status).toHaveText('Manual');
      const labelBox = await page.getByText('Transaction category', {exact: true}).boundingBox();
      const statusBox = await status.boundingBox();
      const controlBox = await page.getByTestId('bank-transaction-category-control').boundingBox();
      expect(
        Math.abs(labelBox!.y + labelBox!.height / 2 - statusBox!.y - statusBox!.height / 2),
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(statusBox!.x + statusBox!.width - controlBox!.x - controlBox!.width),
      ).toBeLessThanOrEqual(1);
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
      const step = page.getByRole('region', {
        name: 'Let AI re-check the newest 3 of 600 other Example Shop payments?',
      });
      await expect(step).toContainText('Each can end up in a different category.');
      await expect(step).toContainText('The 597 older payments stay as they are.');
      await expect(
        step.getByRole('checkbox', {name: 'Shopping to AI picks again', exact: true}),
      ).toBeChecked();
      await expect(step.getByText('AI picks again', {exact: true})).toHaveCount(2);
      // The outcome is unknown, so only the corrected payment's own swap carries an arrow.
      await expect(step.locator('svg.lucide-arrow-right')).toHaveCount(1);
      await step.getByRole('button', {name: 'Re-check newest 3', exact: true}).click();
      await expect(step).toBeHidden();
      expect(state.writes).toEqual([
        {category: 'TRAVEL', applyToTransactionIds: [FIRST_ID, SECOND_ID, THIRD_ID]},
      ]);
    });

    test('a long worst-case preview from another category names it in full, scrolls, and keeps its actions in reach', async ({
      page,
      browserName,
    }) => {
      const phone = page.viewportSize()!.width < 768;
      // The longest category name, on the narrowest phone this run covers.
      if (phone) await page.setViewportSize({width: 320, height: 640});
      const rows = Array.from({length: 100}, (_, index) => ({
        ...impact.transactions[0],
        id: `00000000-0000-4000-8000-${String(400 + index).padStart(12, '0')}`,
        displayDescription:
          index === 2 ? 'Example Regional Department Store Terminal 202' : 'Example Shop',
        ...(index === 3 && {
          amount: '-98765432.00',
          currency: 'IDR',
          transactionDate: '2025-09-28',
        }),
      }));
      const state = await mockCorrection(page, {
        ...impact,
        category: 'TAXES_AND_GOVERNMENT',
        total: 600,
        transactions: rows,
      });
      await chooseTravel(page);
      const step = page.getByRole('region', {
        name: 'Move other matching payments to Taxes and government too?',
      });
      await expect(step).toContainText('The newest 100 of 600 other payments can follow:');
      await expect(
        step.getByRole('checkbox', {name: 'Shopping to Taxes and government', exact: true}),
      ).toBeChecked();
      const move = step.getByRole('button', {
        name: 'Move newest 100 to Taxes and government',
        exact: true,
      });
      await step.getByRole('button', {name: '100 Shopping payments', exact: true}).click();
      await animationsSettled(step);
      const isCut = (element: HTMLElement) =>
        element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight;
      expect(await move.evaluate(isCut)).toBe(false);
      // The widest amount leaves its row's date whole.
      expect(await step.getByText('Sep 28, 2025', {exact: true}).evaluate(isCut)).toBe(false);
      // With the browser's text at 150%, the widest amount and a long category name still show whole.
      await page.addStyleTag({content: 'html { font-size: 150%; }'});
      await step
        .getByRole('checkbox', {
          name: 'Example Regional Department Store Terminal 202, Sep 9, 2026, -€12.00',
          exact: true,
        })
        .uncheck();
      const within = (element: HTMLElement) => {
        const box = element.getBoundingClientRect();
        const row = element.closest('li')!.getBoundingClientRect();
        return box.left >= row.left && box.right <= row.right;
      };
      for (const label of [
        step.getByText('Taxes and government', {exact: true}).first(),
        step.getByText(/IDR/).first(),
      ]) {
        expect(await label.evaluate(isCut)).toBe(false);
        expect(await label.evaluate(within)).toBe(true);
      }
      await page.addStyleTag({content: 'html { font-size: 100%; }'});
      await step
        .getByRole('checkbox', {
          name: 'Example Regional Department Store Terminal 202, Sep 9, 2026, -€12.00',
          exact: true,
        })
        .check();
      // A long name wraps in full: these rows don't open, and its end can tell two payments apart.
      const longName = step.getByText('Example Regional Department Store Terminal 202', {
        exact: true,
      });
      expect(await longName.evaluate(isCut)).toBe(false);
      await expectNoHorizontalOverflow(page);

      const viewport = step.locator('[data-radix-scroll-area-viewport]');
      const body = await viewport.boundingBox();
      const x = body!.x + body!.width / 2;
      // Touch gestures are sent with Chromium DevTools; WebKit scrolls with the wheel.
      if (phone && browserName === 'chromium') {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Emulation.setTouchEmulationEnabled', {enabled: true});
        const [from, to] = [body!.y + body!.height - 20, body!.y + 20];
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{x, y: from}],
        });
        for (let step = 1; step <= 10; step++) {
          await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{x, y: from + ((to - from) * step) / 10}],
          });
          await page.evaluate(() => new Promise(requestAnimationFrame));
        }
        await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
        await cdp.send('Emulation.setTouchEmulationEnabled', {enabled: false});
      } else {
        await page.mouse.move(x, body!.y + body!.height / 2);
        await page.mouse.wheel(0, 4000);
      }
      await expect
        .poll(() => viewport.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(100);

      // On a short landscape phone the header scrolls away with the list; every action stays on screen.
      if (phone) await page.setViewportSize({width: 667, height: 300});
      for (const name of ['Cancel', 'Only this one']) {
        const box = await step.getByRole('button', {name, exact: true}).boundingBox();
        expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
      }
      const box = await move.boundingBox();
      expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
      await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await expect(step).toBeHidden();
      expect(state.writes).toEqual([
        {category: 'TRAVEL', applyToTransactionIds: rows.map(({id}) => id)},
      ]);
    });

    test('does not save after a preview failure', async ({page}) => {
      const state = await mockCorrection(page);
      state.previewStatus = 500;
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

    test('closing a pending preview neither saves later nor marks Wisp offline', async ({page}) => {
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
          page.getByTitle('Wisp is unreachable. Changes cannot be saved until it reconnects.'),
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

    for (const {failure, status, message} of [
      {
        failure: 'failed',
        status: 500,
        message: 'Transaction category could not be saved. Try again.',
      },
      {failure: 'rate-limited', status: 429, message: 'Rate limit exceeded'},
    ]) {
      test(`reports a ${failure} save once and retains the selection so it can be retried`, async ({
        page,
      }) => {
        const state = await mockCorrection(page);
        state.saveStatus = status;
        await chooseTravel(page);
        const step = impactStep(page);
        const food = step.getByRole('checkbox', {name: 'Eating out to Travel', exact: true});
        await food.uncheck();
        const move = step.getByRole('button', {name: 'Move 2 to Travel', exact: true});
        await move.click();
        await expect(page.getByText(message, {exact: true})).toBeVisible();
        await expect(page.locator('[data-sonner-toast]')).toHaveCount(1);
        await expect(food).not.toBeChecked();
        state.saveStatus = 200;
        await move.click();
        await expect(step).toBeHidden();
        expect(state.writes).toEqual([
          {category: 'TRAVEL', applyToTransactionIds: [FIRST_ID, THIRD_ID]},
          {category: 'TRAVEL', applyToTransactionIds: [FIRST_ID, THIRD_ID]},
        ]);
      });
    }
  });
}
