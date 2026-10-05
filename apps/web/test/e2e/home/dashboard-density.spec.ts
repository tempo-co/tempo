import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';

import {septemberSummary} from '../../data/home-summary.data';
import {expect, test} from '../../fixtures';
import {fulfillJson, mockBankConnections, mockJson} from '../../utils/api-mocks';
import {boxOf, expectNoHorizontalOverflow} from '../../utils/layout';

// Every response is synthetic: these checks never read or mutate a shared API stack.
test.use({storageState: {cookies: [], origins: []}});
test.beforeEach(async ({page}) => {
  await page.clock.setFixedTime(new Date('2026-10-01T12:00:00Z'));
  await mockJson(page, '**/accounts/me', {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'dashboard@example.com',
    isEmailVerified: true,
  });
  await mockBankConnections(page, [
    {
      id: '00000000-0000-4000-8000-000000000002',
      provider: 'EXAMPLE',
      aspspName: 'Example Bank',
      aspspCountry: 'NL',
      status: 'AUTHORIZED',
      consentValidUntil: '2027-01-01T00:00:00Z',
      lastSyncedAt: '2026-10-01T11:00:00Z',
      lastSyncError: null,
      nextSyncAt: '2026-10-02T11:00:00Z',
      syncStatus: 'SUCCEEDED',
      baseCurrency: 'EUR',
      bankAccounts: [
        {
          id: '00000000-0000-4000-8000-000000000003',
          name: 'Example Account Holder',
          alias: 'Example spending account',
          details: null,
          currency: 'EUR',
          cashAccountType: null,
          usage: null,
          maskedIdentifier: null,
          currentBalanceAmount: '100.00',
          currentBalanceInBaseCurrency: '100.00',
          baseCurrencyRateDate: null,
          currentBalanceType: null,
          balanceUpdatedAt: '2026-10-01T11:00:00Z',
          isActive: true,
          latestBalances: [],
        },
      ],
    },
  ]);
  await mockJson(page, '**/bank-connections/aspsps', [
    {name: 'Example Bank', country: 'NL', logoUrl: 'https://assets.example.test/bank.png'},
  ]);
  await page.route('https://assets.example.test/bank.png', (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j63kAAAAASUVORK5CYII=',
        'base64',
      ),
    }),
  );
  await mockJson(page, '**/bank-transactions/summary**', septemberSummary);
  await mockJson(page, '**/bank-transactions/review-counts', {
    needsReview: 0,
    categorizationFailed: 0,
    categorizing: 0,
    unknownDirection: 0,
    missingBaseAmount: 0,
  });
  await page.route('**/bank-transactions?**', (route) => {
    const size = Number(new URL(route.request().url()).searchParams.get('pagination[pageSize]'));
    return fulfillJson(route, {
      total: 12,
      transactions: Array.from({length: size}, (_, index) => ({
        id: `00000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
        bookingDate: '2026-09-30',
        description: `Example transaction ${index + 1}`,
        amount: '10.00',
        currency: 'EUR',
        category: 'OTHER',
        categoryStatus: 'COMPLETED',
        categorySource: 'MANUAL',
        financialEventType: null,
        cashFlowTreatment: 'EXPENSE',
      })),
    });
  });
});

for (const width of [1440, 390]) {
  test(`recent insets its last row like the card's sides at ${width}px`, async ({page}) => {
    await page.setViewportSize({width, height: 1000});
    await page.goto('/?month=2026-09');
    const recent = page.getByRole('region', {name: 'Latest in September 2026'});
    await expect(recent.locator('li')).toHaveCount(5);
    const card = await boxOf(recent);
    const lastRow = recent.locator('li').last();
    const title = await boxOf(lastRow.getByText('Example transaction 5'));
    const amount = await boxOf(lastRow.getByText('€10.00'));
    const meta = await boxOf(lastRow.getByText(/30 Sep/));
    const side = title.x - card.x;
    expect(card.x + card.width - amount.x - amount.width).toBeCloseTo(side, 0);
    expect(card.y + card.height - meta.y - meta.height).toBeCloseTo(side, 0);
  });
}

test('balances emphasize the bank with the account holder below it', async ({page}) => {
  await page.goto('/?month=2026-09');
  const row = page.getByRole('region', {name: 'Balances'}).locator('li').first();
  const bank = row.getByText('Example Bank', {exact: true});
  const holder = row.getByText('Example Account Holder · Example spending account', {exact: true});
  await expect(holder).toBeVisible();
  await expect(row.getByTestId('bank-balance-logo').locator('img')).toHaveAttribute(
    'src',
    'https://assets.example.test/bank.png',
  );
  expect(
    await row
      .getByTestId('bank-balance-logo')
      .locator('img')
      .evaluate((image: HTMLImageElement) => image.naturalWidth),
  ).toBeGreaterThan(0);
  // Close to the Connections page logo (72px) while fitting a balance row.
  const logo = await boxOf(row.getByTestId('bank-balance-logo'));
  expect(logo.width).toBe(56);
  expect(logo.height).toBe(56);
  const bankBox = await boxOf(bank);
  const holderBox = await boxOf(holder);
  expect(holderBox.y).toBeGreaterThan(bankBox.y);
  const bankSize = await bank.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  const holderSize = await holder.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(bankSize).toBeGreaterThan(holderSize);
});

test('chart legend contains comparisons without an interaction caption', async ({page}) => {
  await page.goto('/?month=2026-09');
  const legend = page.getByTestId('spending-summary').getByText('Lowest to highest').locator('..');
  await expect(legend).toBeVisible();
  await expect(page.getByTestId('spending-summary')).not.toContainText('Hover a day');
});

for (const width of [1440, 390, 320]) {
  test(`month navigation stays anchored across different title lengths at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({width, height: 1000});
    const boxes = [];
    for (const month of ['2026-05', '2026-09', '2026-10']) {
      await page.goto(`/?month=${month}`);
      const title = page.getByRole('heading', {level: 1});
      await expect(title).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      boxes.push({
        title: await boxOf(title),
        previous: await boxOf(page.getByRole('link', {name: 'Previous month'})),
        next: await boxOf(page.getByLabel('Next month', {exact: true})),
      });
      await expectNoHorizontalOverflow(page);
    }
    for (const box of boxes.slice(1)) {
      expect(box.title).toEqual(boxes[0].title);
      expect(box.previous).toEqual(boxes[0].previous);
      expect(box.next).toEqual(boxes[0].next);
    }
  });
}

for (const width of [1440, 390]) {
  for (const theme of ['light', 'dark']) {
    test(`synthetic dashboard remains readable at ${width}px in ${theme}`, async ({page}) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.setViewportSize({width, height: 1000});
      await page.addInitScript((value) => localStorage.setItem('vite-ui-theme', value), theme);
      await page.goto('/?month=2026-09');
      await expect(page.getByRole('region', {name: 'Balances'})).toContainText(
        'Example Account Holder',
      );
      await expect(
        page.getByRole('region', {name: 'Latest in September 2026'}).locator('li'),
      ).toHaveCount(5);
      await expect(
        page.getByTestId('spending-summary').getByText('Lowest to highest'),
      ).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expectNoHorizontalOverflow(page);
      expect(errors).toEqual([]);
      if (process.env.HOME_DENSITY_CAPTURE_DIR) {
        await mkdir(process.env.HOME_DENSITY_CAPTURE_DIR, {recursive: true});
        await page.screenshot({
          path: join(
            process.env.HOME_DENSITY_CAPTURE_DIR,
            `dashboard-density-${theme}-${width}.png`,
          ),
          fullPage: true,
        });
      }
    });
  }
}

test('recent requests and shows only five transactions', async ({page}) => {
  const request = page.waitForRequest((request) => request.url().includes('/bank-transactions?'));
  await page.goto('/?month=2026-09');
  expect(new URL((await request).url()).searchParams.get('pagination[pageSize]')).toBe('5');
  await expect(
    page.getByRole('region', {name: 'Latest in September 2026'}).locator('li'),
  ).toHaveCount(5);
});
