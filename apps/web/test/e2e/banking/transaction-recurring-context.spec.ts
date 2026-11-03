import type {Page} from '@playwright/test';
import {BankTransaction, BankTransactionRecurring} from '@tempo/contracts';

import {expect, test} from '../../fixtures';
import {fulfillJson, mockJson} from '../../utils/api-mocks';
import {boxOf, expectNoHorizontalOverflow} from '../../utils/layout';

const ID = '00000000-0000-4000-8000-000000000851';
const transaction: BankTransaction = {
  id: ID,
  displayDescription: 'Example Subscription',
  description: 'EXAMPLE SUBSCRIPTION PAYMENT REFERENCE 0042',
  counterpartyName: null,
  transactionDate: '2026-10-29',
  bookingDate: '2026-10-30',
  valueDate: '2026-10-30',
  amount: '-12.99',
  currency: 'EUR',
  creditDebitIndicator: 'DBIT',
  direction: 'EXPENSE',
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
  referenceNumber: 'EXAMPLE-0042',
  referenceNumberScheme: null,
  bankName: 'Example Bank',
  bankCountry: 'NL',
  bankAccountName: 'Everyday',
  bankAccountAlias: null,
  category: 'SUBSCRIPTIONS',
  categoryStatus: 'COMPLETED',
  categorySource: 'AI',
  categoryConfidence: null,
  financialEventType: null,
  financialEventSource: null,
  financialEventRuleVersion: null,
  cashFlowTreatment: 'EXPENSE',
  merchantLogoUrl: null,
  merchantGroupId: null,
  ownTransfer: null,
  ownTransferOverride: null,
  currencyExchangeCounterpart: null,
  amountInBaseCurrency: null,
  baseAmountMethod: null,
  baseAmountRateDate: null,
};
const series: BankTransactionRecurring = {
  key: 'a'.repeat(32),
  cadence: 'MONTHLY',
  status: 'ACTIVE',
  nextExpectedDate: '2026-11-29',
  payments: [
    {
      id: ID,
      transactionDate: '2026-10-29',
      bookingDate: '2026-10-30',
      amount: '-12.99',
      currency: 'EUR',
    },
    {
      id: '00000000-0000-4000-8000-000000000852',
      transactionDate: '2026-09-29',
      bookingDate: '2026-09-30',
      amount: '-12.99',
      currency: 'EUR',
    },
    {
      id: '00000000-0000-4000-8000-000000000853',
      transactionDate: '2026-08-29',
      bookingDate: '2026-08-30',
      amount: '-12.99',
      currency: 'EUR',
    },
  ],
};

async function mockDetails(page: Page) {
  await mockJson(page, '**/accounts/me', {
    id: '00000000-0000-4000-8000-000000000850',
    name: 'Example Owner',
    email: 'user@example.com',
    isEmailVerified: true,
  });
  await page.route('**/bank-transactions?**', (route) =>
    route.request().isNavigationRequest()
      ? route.continue()
      : fulfillJson(route, {transactions: [transaction], total: 1}),
  );
  await mockJson(page, `**/bank-transactions/${ID}`, transaction);
}

for (const width of [320, 390, 1440]) {
  test.describe(`transaction recurring context at ${width}px`, () => {
    test.use({
      storageState: {cookies: [], origins: []},
      viewport: {width, height: 844},
      hasTouch: width < 768,
      timezoneId: 'Europe/Amsterdam',
    });

    test('inspects recurring history and refreshes its membership after a category correction', async ({
      page,
      browserName,
    }) => {
      if (browserName === 'chromium' && width < 768) test.slow();
      await page.clock.install({time: new Date('2026-11-02T12:00:00+01:00')});
      await mockDetails(page);
      let saved = {...transaction};
      let recurring: typeof series | null = {...series};
      let reads = 0;
      await page.route('**/bank-transactions?**', (route) =>
        route.request().isNavigationRequest()
          ? route.continue()
          : fulfillJson(route, {transactions: [saved], total: 1}),
      );
      await page.route(`**/bank-transactions/${ID}`, (route) => fulfillJson(route, saved));
      await page.route(`**/bank-transactions/${ID}/recurring?**`, (route) => {
        expect(new URL(route.request().url()).searchParams.get('asOf')).toBe('2026-11-02');
        reads++;
        return fulfillJson(route, recurring);
      });
      await mockJson(page, `**/bank-transactions/${ID}/category-impact?**`, {
        action: null,
        category: null,
        transactions: [],
        total: 0,
      });
      await page.route(`**/bank-transactions/${ID}/category`, (route) => {
        saved = {...saved, category: 'OTHER', categorySource: 'MANUAL'};
        recurring = null;
        return fulfillJson(route, saved);
      });
      await page.goto(`/bank-transactions?transactionId=${ID}`);
      const inspector = page.getByTestId('bank-transaction-inspector');
      await expect(
        inspector.getByRole('button', {name: 'Recurring payment', exact: true}),
      ).toBeVisible();
      await expect(inspector).toContainText('Monthly · Next expected Nov 29, 2026');
      const source = inspector.getByTestId('bank-transaction-category-status');
      await expect(source).toHaveText('Suggested by AI');
      const category = inspector.getByTestId('bank-transaction-category-control');
      await inspector.evaluate((el) =>
        Promise.all(el.getAnimations({subtree: true}).map((animation) => animation.finished)),
      );
      const before = await boxOf(category);
      const bank = inspector.getByRole('button', {name: 'Bank details', exact: true});
      const settings = inspector.getByRole('button', {name: 'Transfer settings', exact: true});
      for (const disclosure of [bank, settings]) {
        const box = await boxOf(disclosure);
        expect({x: box.x, width: box.width}).toEqual({x: before.x, width: before.width});
      }
      const hoverColor = await page.evaluate(() => {
        const probe = document.createElement('span');
        probe.className = 'bg-accent';
        document.body.append(probe);
        const color = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return color;
      });
      if (width >= 768) {
        await bank.hover();
        await expect(bank).toHaveCSS('background-color', hoverColor);
        await settings.hover();
        await expect(settings).toHaveCSS('background-color', hoverColor);
      }
      await inspector.getByRole('button', {name: 'Recurring payment', exact: true}).click();
      await expect(inspector.getByText('This payment', {exact: true})).toBeVisible();
      await expect(inspector.getByText('Sep 29, 2026', {exact: true})).toBeVisible();
      for (const disclosure of [bank, settings]) {
        const box = await boxOf(disclosure);
        await disclosure.click({position: {x: box.width - 8, y: box.height / 2}});
        await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
      }
      await expect(
        inspector.getByText(
          'Mark this as an own transfer to exclude it from income and spending.',
          {exact: true},
        ),
      ).toBeVisible();
      const after = await boxOf(category);
      expect(after.x).toBe(before.x);
      expect(after.width).toBe(before.width);
      const viewport = inspector.locator('[data-radix-scroll-area-viewport]');
      expect(await viewport.evaluate((el: HTMLElement) => el.offsetWidth - el.clientWidth)).toBe(0);
      await viewport.hover();
      await page.mouse.wheel(0, 1600);
      await expect.poll(() => viewport.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
      await expect(
        inspector.getByRole('button', {name: 'Mark as own transfer', exact: true}),
      ).toBeInViewport();
      if (browserName === 'chromium' && width < 768) {
        await viewport.evaluate((el) => {
          el.scrollTop = 0;
        });
        const box = await boxOf(viewport);
        const touch = await page.context().newCDPSession(page);
        for (let swipe = 0; swipe < 3; swipe++) {
          const x = box.x + box.width / 2,
            y = box.y + box.height - 40;
          await touch.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y}]});
          for (let step = 1; step <= 10; step++) {
            await touch.send('Input.dispatchTouchEvent', {
              type: 'touchMove',
              touchPoints: [{x, y: y - step * 24}],
            });
            await page.evaluate(() => new Promise(requestAnimationFrame));
          }
          await touch.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
        }
        await expect(
          inspector.getByRole('button', {name: 'Mark as own transfer', exact: true}),
        ).toBeInViewport();
      }
      await expectNoHorizontalOverflow(page);
      await page.clock.resume();
      await inspector.getByRole('combobox', {name: 'Transaction category'}).click();
      await page.getByRole('option', {name: 'Other', exact: true}).click();
      await expect(source).toHaveText('Manual');
      await expect.poll(() => reads).toBeGreaterThan(1);
      await expect(
        inspector.getByRole('button', {name: 'Recurring payment', exact: true}),
      ).toHaveCount(0);
    });

    test('shows ended recurring history with its last payments', async ({page}) => {
      await mockDetails(page);
      await mockJson(page, `**/bank-transactions/${ID}/recurring?**`, {...series, status: 'ENDED'});
      await page.goto(`/bank-transactions?transactionId=${ID}`);
      const fold = page.getByTestId('recurring-fold');
      await expect(fold.locator('p').first()).toHaveText('Monthly · Ended');
      await fold.getByRole('button', {name: 'Recurring payment', exact: true}).click();
      await expect(fold.getByText('This payment', {exact: true})).toBeVisible();
      await expect(fold.getByText('Sep 29, 2026', {exact: true})).toBeVisible();
    });

    test('retries unavailable recurring context while preserving payment details', async ({
      page,
    }) => {
      await mockDetails(page);
      let reads = 0;
      await page.route(`**/bank-transactions/${ID}/recurring?**`, (route) =>
        ++reads === 1
          ? route.fulfill({
              status: 503,
              contentType: 'application/json',
              body: JSON.stringify({message: 'Unavailable'}),
            })
          : fulfillJson(route, series),
      );
      await page.goto(`/bank-transactions?transactionId=${ID}`);
      const inspector = page.getByTestId('bank-transaction-inspector');
      await expect(inspector.getByText('Recurring details unavailable.')).toBeVisible();
      await expect(inspector.getByTestId('bank-transaction-detail-amount')).toContainText('12.99');
      await expect(inspector.getByRole('combobox', {name: 'Transaction category'})).toBeEnabled();
      await inspector.getByRole('button', {name: 'Try again', exact: true}).click();
      await expect(
        inspector.getByRole('button', {name: 'Recurring payment', exact: true}),
      ).toBeVisible();
    });
  });
}
