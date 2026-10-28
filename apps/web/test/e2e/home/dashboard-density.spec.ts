import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';

import {septemberSummary} from '../../data/home-summary.data';
import {expect, test} from '../../fixtures';
import {
  fulfillJson,
  mockBalanceTrend,
  mockBankConnections,
  mockBankRefresh,
  mockCashFlow,
  mockJson,
} from '../../utils/api-mocks';
import {boxOf, expectNoHorizontalOverflow} from '../../utils/layout';

// Every response is synthetic: these checks never read or mutate a shared API stack.
test.use({storageState: {cookies: [], origins: []}});
test.beforeEach(async ({page}) => {
  await page.clock.setFixedTime(new Date('2026-10-01T12:00:00Z'));
  await mockJson(page, '**/accounts/me', {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Example Owner',
    email: 'dashboard@example.com',
    isEmailVerified: true,
  });
  await mockBankRefresh(page);
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
  await mockJson(page, '**/recurring-series/summary?**', {
    expenseMonthlyTotal: '0.00',
    incomeMonthlyTotal: '0.00',
    upcoming: [],
    expenseUnconvertedCount: 0,
    incomeUnconvertedCount: 0,
    baseCurrency: 'EUR',
  });
  await mockCashFlow(page);
  await mockBalanceTrend(page);
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
        page.getByTestId('cash-flow').locator('.recharts-bar-rectangle').first(),
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

for (const width of [1440, 390]) {
  test(`card titles sit at one offset and balances align with bank names at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({width, height: 1000});
    await page.goto('/?month=2026-09');
    await expect(
      page.getByTestId('cash-flow').locator('.recharts-bar-rectangle').first(),
    ).toBeVisible();
    const offsets = await page.locator('main h2').evaluateAll((titles) =>
      titles.map((title) => {
        const card = title.closest('.rounded-card')!;
        return Math.round(title.getBoundingClientRect().top - card.getBoundingClientRect().top);
      }),
    );
    expect(offsets.length).toBeGreaterThan(3);
    expect(new Set(offsets).size).toBe(1);
    const row = page.getByRole('region', {name: 'Balances'}).locator('li').first();
    const bank = await boxOf(row.getByText('Example Bank', {exact: true}));
    const amount = await boxOf(row.getByText('€100.00'));
    expect(Math.abs(amount.y - bank.y)).toBeLessThanOrEqual(1);
  });
}

for (const width of [1440, 390]) {
  test(`weekly balance labels identify the snapshot directly above them at ${width}px`, async ({page}) => {
    await page.setViewportSize({width, height: 1000});
    await mockJson(page, '**/bank-transactions/balance-trend**', {
      baseCurrency: 'EUR',
      interval: 'week',
      periods: Array.from({length: 5}, (_, index) => ({
        start: index === 0 ? '2026-08-31' : `2026-09-${String(index * 7).padStart(2, '0')}`,
        end: index === 4 ? '2026-10-01' : `2026-09-${String(6 + index * 7).padStart(2, '0')}`,
        complete: index < 4,
        total: `${1000 + index * 250}.00`,
        accounts: [],
      })),
    });
    await page.goto('/');
    const card = page.getByTestId('balance-trend');
    await card.getByRole('radio', {name: 'Week'}).click();
    const labels = card.locator('.recharts-xAxis-tick-labels text');
    await expect(labels).toHaveText(['6 Sep', '1 Oct']);
    const chart = await boxOf(card.locator('.recharts-surface'));
    for (const [index, title] of ['6 Sep 2026', 'Today'].entries()) {
      const label = await boxOf(labels.nth(index));
      await page.mouse.move(label.x + label.width / 2, chart.y + chart.height / 2);
      await expect(card.locator('.recharts-tooltip-wrapper')).toBeVisible();
      await expect(card.locator('.recharts-tooltip-wrapper')).toContainText(title);
    }
  });
}

test('pointer clicks leave chart surfaces and marks without focus outlines', async ({page}) => {
  await page.goto('/');
  for (const name of ['balance-trend', 'cash-flow']) {
    const chart = page.getByTestId(name).locator('[data-slot="chart"]');
    await chart.scrollIntoViewIfNeeded();
    await chart.click({position: {x: 5, y: 5}});

    const mark = chart.locator('.recharts-bar-rectangle path, .recharts-area-curve').last();
    await mark.click({force: true});
    const outlines = await chart.evaluate((el) => Array.from(el.querySelectorAll('*')).filter((item) => {
      const style = getComputedStyle(item);
      return item.matches(':focus') && style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
    }).map((item) => item.getAttribute('class')));
    expect(outlines).toEqual([]);
  }
});

test.describe('touch chart inspection', () => {
  test.use({hasTouch: true, isMobile: true, viewport: {width: 390, height: 844}});

  test('holding and scrubbing shows each period until release', async ({page, context}) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'vibrate', {value: () => {
        const root = document.documentElement;
        root.dataset.chartPulses = String(Number(root.dataset.chartPulses ?? 0) + 1);
        return true;
      }});
    });
    await page.goto('/?month=2026-09');
    const touch = await context.newCDPSession(page);
    for (const [name, first, last] of [
      ['balance-trend', '31 Jul 2026', '30 Sep 2026'],
      ['cash-flow', 'July 2026', 'September 2026'],
    ]) {
      const card = page.getByTestId(name);
      const plot = card.locator('[data-slot="chart"]');
      await plot.scrollIntoViewIfNeeded();
      const labels = card.locator('.recharts-xAxis-tick-labels text');
      const start = await boxOf(labels.first());
      const end = await boxOf(labels.last());
      const box = await boxOf(plot);
      const y = Math.round(box.y + box.height / 2);
      const x = Math.round(start.x + start.width / 2);
      const tooltip = card.locator('.recharts-tooltip-wrapper');
      const url = page.url();
      await touch.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y}]});
      await expect(tooltip).not.toBeVisible();
      await expect(tooltip).toBeVisible();
      await expect(tooltip).toContainText(first);
      const pulses = Number(await page.locator('html').getAttribute('data-chart-pulses'));
      expect(pulses).toBeGreaterThan(0);
      await touch.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: x + 1, y}]});
      await expect(page.locator('html')).toHaveAttribute('data-chart-pulses', String(pulses));
      await touch.send('Input.dispatchTouchEvent', {
        type: 'touchMove', touchPoints: [{x: Math.round(end.x + end.width / 2), y}],
      });
      await expect(tooltip).toContainText(last);
      await expect(page.locator('html')).toHaveAttribute('data-chart-pulses', String(pulses + 1));
      const readout = await boxOf(tooltip);
      expect(readout.y + readout.height).toBeLessThan(y);
      expect(readout.x).toBeGreaterThanOrEqual(0);
      expect(readout.x + readout.width).toBeLessThanOrEqual(390);
      if (process.env.HOME_DENSITY_CAPTURE_DIR) {
        await page.screenshot({path: join(process.env.HOME_DENSITY_CAPTURE_DIR, `${name}-touch.png`)});
      }
      await touch.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
      await expect(tooltip).not.toBeVisible();
      await expect(card.locator('.recharts-tooltip-cursor')).toHaveCount(0);
      await expect(page).toHaveURL(url);
    }
  });

  test('horizontal scrubbing inspects while a short tap selects a month', async ({page, context}) => {
    // Safari has no Vibration API; inspection is complete without it.
    await page.addInitScript(() => Object.defineProperty(navigator, 'vibrate', {value: undefined}));
    await page.goto('/?month=2026-09');
    const card = page.getByTestId('cash-flow');
    const plot = card.locator('[data-slot="chart"]');
    await plot.scrollIntoViewIfNeeded();
    const start = await boxOf(card.locator('.recharts-xAxis-tick-labels text').first());
    const box = await boxOf(plot);
    const x = Math.round(start.x + start.width / 2);
    const y = Math.round(box.y + box.height / 2);
    const touch = await context.newCDPSession(page);
    const url = page.url();
    await touch.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y}]});
    await touch.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: x + 1, y}]});
    await touch.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: x + 15, y}]});
    await expect(card.locator('.recharts-tooltip-wrapper')).toContainText('July 2026');
    await expect(card.locator('.recharts-tooltip-wrapper')).toBeVisible();
    const end = await boxOf(card.locator('.recharts-xAxis-tick-labels text').last());
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{x: Math.round(end.x + end.width / 2), y}],
    });
    await expect(card.locator('.recharts-tooltip-wrapper')).toBeVisible();
    await expect(card.locator('.recharts-tooltip-wrapper')).toContainText('September 2026');
    await touch.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x, y}]});
    await expect(card.locator('.recharts-tooltip-wrapper')).toContainText('July 2026');
    await touch.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
    await expect(card.locator('.recharts-tooltip-wrapper')).not.toBeVisible();
    // A browser compatibility click after a scrub must not activate its bar.
    await card.locator('.recharts-wrapper').dispatchEvent('click', {clientX: x, clientY: y, detail: 1});
    await expect(page).toHaveURL(url);
    await page.touchscreen.tap(x, y);
    await expect(page).toHaveURL(/month=2026-07/);
    await expect(card.locator('.recharts-tooltip-wrapper')).not.toBeVisible();
    const august = card.getByRole('link', {name: 'August 2026', includeHidden: true});
    await august.focus();
    await expect(august).toBeInViewport();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/month=2026-08/);
  });

  for (const interval of ['Week', 'Year']) {
    test(`a short ${interval.toLowerCase()} tap opens its transactions`, async ({page}) => {
      const start = interval === 'Week' ? '2026-09-07' : '2025-01-01';
      const end = interval === 'Week' ? '2026-09-13' : '2025-12-31';
      await mockJson(page, '**/bank-transactions/cash-flow**', {
        baseCurrency: 'EUR', interval: interval.toLowerCase(),
        periods: [{start, end, complete: true, spending: '100.00', income: '200.00', net: '100.00'}],
      });
      await page.goto('/?month=2026-09');
      const card = page.getByTestId('cash-flow');
      await card.getByRole('radio', {name: interval}).click();
      const chart = card.locator('[data-slot="chart"]');
      await chart.scrollIntoViewIfNeeded();
      const label = await boxOf(card.locator('.recharts-xAxis-tick-labels text').first());
      const box = await boxOf(chart);
      await page.touchscreen.tap(label.x + label.width / 2, box.y + box.height / 2);
      await expect(page).toHaveURL(/\/bank-transactions/);
      const range = JSON.parse(new URL(page.url()).searchParams.get('bookingDate')!) as {from: string; to: string};
      const dates = await page.evaluate(({from, to}) => [from, to].map((value) => {
        const date = new Date(value);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      }), range);
      expect(dates).toEqual([start, end]);
    });
  }

  test('vertical gestures scroll the page and cancellation ends inspection', async ({page, context}) => {
    await page.goto('/?month=2026-09');
    const card = page.getByTestId('balance-trend');
    const plot = card.locator('[data-slot="chart"]');
    await plot.scrollIntoViewIfNeeded();
    const box = await boxOf(plot);
    const x = Math.round(box.x + box.width / 2);
    const y = Math.round(box.y + box.height / 2);
    const before = await page.evaluate(() => window.scrollY);
    const touch = await context.newCDPSession(page);
    await touch.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y}]});
    for (const distance of [20, 50, 90]) {
      await touch.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x, y: y - distance}]});
    }
    await touch.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
    await expect(card.locator('.recharts-tooltip-wrapper')).not.toBeVisible();
    await plot.scrollIntoViewIfNeeded();
    const next = await boxOf(plot);
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchStart', touchPoints: [{x, y: Math.round(next.y + next.height / 2)}],
    });
    await expect(card.locator('.recharts-tooltip-wrapper')).toBeVisible();
    await touch.send('Input.dispatchTouchEvent', {type: 'touchCancel', touchPoints: []});
    await expect(card.locator('.recharts-tooltip-wrapper')).not.toBeVisible();
    // Headless Chromium does not zoom even on an unhandled plain page. Check the
    // browser gesture policy here; real-device pinch remains part of the phone trial.
    await expect(plot).toHaveCSS('touch-action', 'pan-y pinch-zoom');
  });
});

test('recent requests and shows only five transactions', async ({page}) => {
  const request = page.waitForRequest((request) => request.url().includes('/bank-transactions?'));
  await page.goto('/?month=2026-09');
  expect(new URL((await request).url()).searchParams.get('pagination[pageSize]')).toBe('5');
  await expect(
    page.getByRole('region', {name: 'Latest in September 2026'}).locator('li'),
  ).toHaveCount(5);
});
