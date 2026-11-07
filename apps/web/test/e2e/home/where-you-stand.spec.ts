import type {Locator} from '@playwright/test';

import {PHONE_KEY, homeHistory, mockSyntheticHome} from '../../data/home-history.data';
import {expect, test} from '../../fixtures';
import {fulfillJson} from '../../utils/api-mocks';
import {boxOf, expectLoaded} from '../../utils/layout';

// Every response is synthetic: these checks never read or mutate a shared API stack.
test.use({storageState: {cookies: [], origins: []}, timezoneId: 'Europe/Amsterdam'});

test('shows the total, its change over each span, and the span’s money in and out', async ({
  page,
  homePage,
}) => {
  await mockSyntheticHome(page);
  await page.goto('/');

  const card = homePage.whereYouStand;
  await expect(homePage.totalBalance).toHaveText('€24,300');
  // A year back from 5 November is the end of October 2025, when the balance was €15,000.
  await expect(card).toContainText('+€9,300+62%since 31 Oct 2025');
  const span = card.getByRole('region', {name: 'This span'});
  await expect(span.getByRole('heading', {level: 2})).toHaveText('Nov 2025 – now');
  for (const [label, value] of [
    ['In', '€36,000'],
    ['Out', '€26,700'],
    ['Kept', '+€9,300'],
    ['Kept of income', '26%'],
    ['Balance', '€15,000 → €24,300'],
  ]) {
    await expect(span.getByText(label, {exact: true}).locator('..')).toHaveText(`${label}${value}`);
  }
  await expect(span.getByRole('link', {name: 'Transactions in this span'})).toHaveAttribute(
    'href',
    /bookingDate/,
  );

  await card.getByRole('button', {name: '6M'}).click();
  await expect(card.getByRole('button', {name: '6M'})).toHaveAttribute('aria-pressed', 'true');
  await expect(card).toContainText('+€4,800+25%since 30 Apr 2026');

  // Longer than the history: measured from zero, before the first month.
  for (const name of ['3Y', 'All']) {
    await card.getByRole('button', {name, exact: true}).click();
    await expect(card).toContainText('+€24,300since Dec 2024');
    await expect(span.getByRole('heading', {level: 2})).toHaveText('Dec 2024 – now');
  }
});

test('on the last day of a month, a span is measured from the month end a span back', async ({
  page,
  homePage,
}) => {
  const history = homeHistory();
  for (const periods of [history.trend.periods, history.flow.periods])
    periods[periods.length - 1].end = '2026-11-30';
  await mockSyntheticHome(page, {history});
  await page.clock.setFixedTime(new Date('2026-11-30T12:00:00.000Z'));
  await page.goto('/');

  // A year back from 30 November is 30 November 2025 itself, when the balance was €16,000.
  await expect(homePage.whereYouStand).toContainText('+€8,300+52%since 30 Nov 2025');
  await homePage.whereYouStand.getByRole('button', {name: '6M', exact: true}).click();
  await expect(homePage.whereYouStand).toContainText('since 30 Apr 2026');
});

/** The readout's position and visibility on every frame for the next 400 ms. */
function framesOf(readout: Locator) {
  return readout.evaluate(
    (wrapper) =>
      new Promise<{x: number; width: number; visibility: string}[]>((resolve) => {
        const seen: {x: number; width: number; visibility: string}[] = [];
        const start = performance.now();
        const sample = () => {
          const box = wrapper.getBoundingClientRect();
          seen.push({x: box.x, width: box.width, visibility: getComputedStyle(wrapper).visibility});
          if (performance.now() - start < 400) requestAnimationFrame(sample);
          else resolve(seen);
        };
        requestAnimationFrame(sample);
      }),
  );
}

/** Where month `index` of `count` sits on the balance chart: its x slot inside the axes, at the plot's middle. */
async function monthSlot(plot: Locator, index: number, count: number) {
  const box = await boxOf(plot);
  // The y axis takes 52px on the left, the plot's margin 12px on the right (Y_WIDTH and RIGHT in balance-chart.tsx).
  const width = (box.width - 52 - 12) / count;
  const x = box.x + 52 + width * index;
  return {x, width, centre: {x: Math.round(x + width / 2), y: Math.round(box.y + box.height / 2)}};
}

test('the balance chart reads out the month under the pointer, and a click opens it', async ({
  page,
  homePage,
}) => {
  await page.setViewportSize({width: 1440, height: 1000});
  await mockSyntheticHome(page);
  await page.goto('/');

  await expectLoaded(homePage.whereYouStand);
  const plot = homePage.whereYouStand.locator('[data-slot="chart"]');
  const readout = homePage.whereYouStand.locator('.recharts-tooltip-wrapper');
  // A year back from November 2026 shows fourteen months, from October 2025.
  const march = await monthSlot(plot, 5, 14);
  const april = await monthSlot(plot, 6, 14);
  // Hovering a month shows its readout, ending in what a click opens, and marks the month's whole slot.
  await page.mouse.move(march.centre.x, march.centre.y);
  await expect(readout).toBeVisible();
  await expect(readout.locator('p')).toHaveText([
    'March 2026',
    'Balance€18,500',
    'Kept−€500',
    'Open March ›',
  ]);
  const band = homePage.whereYouStand.locator('[data-slot="month-band"]');
  const slot = await boxOf(band);
  expect(Math.abs(slot.x - march.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(slot.width - march.width)).toBeLessThanOrEqual(1);
  // The band sits behind the line, which stays in view across it.
  expect(
    await band.evaluate((rect) => {
      const curve = rect.closest('svg')!.querySelector('.recharts-area-curve')!;
      return !!(rect.compareDocumentPosition(curve) & Node.DOCUMENT_POSITION_FOLLOWING);
    }),
  ).toBe(true);
  await expect(homePage.whereYouStand.locator('.recharts-surface')).toHaveCSS('cursor', 'pointer');
  // Moving on to the next month keeps the readout up and slides it from one month to the next.
  // It first slides in from the chart's edge; let that settle.
  await expect
    .poll(async () => new Set((await framesOf(readout)).map((frame) => frame.x)).size)
    .toBe(1);
  const frames = framesOf(readout);
  await page.mouse.move(april.centre.x, april.centre.y, {steps: 4});
  for (const frame of await frames) {
    expect(frame.visibility).toBe('visible');
    expect(frame.x).toBeGreaterThanOrEqual(march.centre.x - frame.width);
    expect(frame.x).toBeLessThanOrEqual(april.centre.x + frame.width);
  }
  await expect(readout).toContainText('April 2026');
  // October is in the span twice, so what opens names its year.
  const october = await monthSlot(plot, 12, 14);
  await page.mouse.move(october.centre.x, october.centre.y);
  await expect(readout).toContainText('Open October 2026 ›');
  const november = await monthSlot(plot, 13, 14);
  // The running month reads as so far.
  await page.mouse.move(november.centre.x, november.centre.y);
  await expect(readout).toContainText('November 2026 · so far');
  await expect(readout).toContainText('Kept−€1,200');
  await page.mouse.move(0, 0);
  await expect(readout).not.toBeVisible();
  await page.mouse.click(march.centre.x, march.centre.y);
  await expect(page).toHaveURL(/[?&]month=2026-03/);
  await expect(homePage.monthDialog('March 2026')).toBeVisible();
});

test('repeats show bills and income a month, late bills first, and open their series', async ({
  page,
  homePage,
}) => {
  await mockSyntheticHome(page);
  await page.goto('/');

  const repeats = homePage.whereYouStand.getByRole('region', {name: 'Repeats'});
  await expect(repeats).toContainText('Bills a month€1,250');
  await expect(repeats).toContainText('Income a month€3,000');
  await expect(repeats).toContainText('November: €1,200 paid · €50 to go');
  const rows = repeats.getByRole('listitem');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Example EnergyNot paid yet€35.00');
  await expect(rows.nth(1)).toContainText('Example Mobile14 Nov · in 9 days€15.00');
  await expect(rows.nth(2)).toContainText('Example Landlord1 Dec · in 26 days€1,200.00');

  await rows.nth(1).getByRole('button').click();
  await expect(page).toHaveURL(new RegExp(`recurring=open.*series=${PHONE_KEY}`));
  const dialog = page.getByRole('dialog', {name: 'Recurring payments'});
  await expect(dialog).toBeVisible();
  await page.goBack();
  await expect(dialog).toBeHidden();

  await repeats.getByRole('button', {name: 'All recurring payments'}).click();
  await expect(page).toHaveURL(/recurring=open/);
  await expect(page).not.toHaveURL(/series=/);
  await expect(dialog).toBeVisible();
});

test('leaves out repeats when nothing recurring is found', async ({page, homePage}) => {
  await mockSyntheticHome(page);
  await page.route('**/recurring-series/summary?**', (route) =>
    fulfillJson(route, {
      expenseMonthlyTotal: '0.00',
      incomeMonthlyTotal: '0.00',
      expenseThisMonth: {month: '2026-11', paid: '0.00', remaining: '0.00'},
      incomeThisMonth: {month: '2026-11', paid: '0.00', remaining: '0.00'},
      upcoming: [],
      expenseUnconvertedCount: 0,
      incomeUnconvertedCount: 0,
      baseCurrency: 'EUR',
    }),
  );
  await page.goto('/');
  await expect(homePage.totalBalance).toHaveText('€24,300');
  await expect(homePage.whereYouStand.getByRole('region', {name: 'Repeats'})).toHaveCount(0);
});

test('offers a retry when the history fails to load', async ({page, homePage}) => {
  await mockSyntheticHome(page);
  let fail = true;
  await page.route('**/bank-transactions/cash-flow?**', (route) =>
    fail ? fulfillJson(route, {message: 'Too many requests'}, 429) : route.fallback(),
  );
  await page.goto('/');
  await expect(page.getByText('Could not load your history.')).toBeVisible();
  const retry = page.getByRole('button', {name: 'Try again'});
  await expect(retry).toBeVisible();

  fail = false;
  await retry.click();
  await expect(homePage.totalBalance).toHaveText('€24,300');
});

test('a month without an exchange rate has no balance, and the change is left out', async ({
  page,
  homePage,
}) => {
  const history = homeHistory();
  history.trend.periods[history.trend.periods.length - 1].total = null;
  await mockSyntheticHome(page, {history});
  await page.goto('/');
  await expect(homePage.totalBalance).toHaveText('—');
  await expect(homePage.whereYouStand).not.toContainText('since');
  await expect(homePage.yearTable.getByRole('row').nth(1)).toContainText('—');
  // The month's readout still shows what was kept.
  const november = await monthSlot(homePage.whereYouStand.locator('[data-slot="chart"]'), 13, 14);
  await page.mouse.move(november.centre.x, november.centre.y);
  const readout = homePage.whereYouStand.locator('.recharts-tooltip-wrapper');
  await expect(readout).toContainText('Balance—');
  await expect(readout).toContainText('Kept−€1,200');
});

test('a click on the balance chart opens its month and leaves no focus outline', async ({
  page,
  homePage,
}) => {
  await mockSyntheticHome(page);
  await page.goto('/');
  const chart = homePage.whereYouStand.locator('[data-slot="chart"]');
  const box = await boxOf(chart);
  // The last month sits at the right edge of the plot.
  await page.mouse.click(box.x + box.width - 16, box.y + box.height / 2);
  await expect(page).toHaveURL(/[?&]month=2026-11/);
  const dialog = homePage.monthDialog('November 2026');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  const outlines = await chart.evaluate((element) =>
    Array.from(element.querySelectorAll('*'))
      .filter((item) => {
        const style = getComputedStyle(item);
        return (
          item.matches(':focus') &&
          style.outlineStyle !== 'none' &&
          parseFloat(style.outlineWidth) > 0
        );
      })
      .map((item) => item.getAttribute('class')),
  );
  expect(outlines).toEqual([]);
});

/** Six months, so the first and last month are both labelled on a phone. */
const shortHistory = () => {
  const history = homeHistory();
  history.trend.periods = history.trend.periods.slice(-6);
  history.flow.periods = history.flow.periods.slice(-6);
  return history;
};

test.describe('touch chart inspection', () => {
  test.use({hasTouch: true, isMobile: true, viewport: {width: 390, height: 844}});

  test('a short tap opens the month', async ({page, homePage}) => {
    await mockSyntheticHome(page, {history: shortHistory()});
    await page.goto('/');
    await homePage.whereYouStand.getByRole('button', {name: 'All', exact: true}).click();
    const plot = homePage.whereYouStand.locator('[data-slot="chart"]');
    await plot.scrollIntoViewIfNeeded();
    // From the month slots, not the tick labels: WebKit misplaces SVG tick label boxes.
    const june = await monthSlot(plot, 0, 6);
    await page.touchscreen.tap(june.centre.x, june.centre.y);
    await expect(page).toHaveURL(/[?&]month=2026-06/);
    await expect(homePage.monthDialog('June 2026')).toBeVisible();
  });
});

test.describe('touch chart inspection by sliding', () => {
  test.use({hasTouch: true, isMobile: true, viewport: {width: 390, height: 844}});
  test.skip(
    ({browserName}) => browserName !== 'chromium',
    'Touch moves are sent through Chromium CDP.',
  );

  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    test(`holding and scrubbing shows each month until release (${reducedMotion})`, async ({
      page,
      context,
      homePage,
    }) => {
      await page.emulateMedia({reducedMotion});
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'vibrate', {
          value: () => {
            const root = document.documentElement;
            root.dataset.chartPulses = String(Number(root.dataset.chartPulses ?? 0) + 1);
            return true;
          },
        });
      });
      await mockSyntheticHome(page, {history: shortHistory()});
      await page.goto('/');
      await homePage.whereYouStand.getByRole('button', {name: 'All', exact: true}).click();
      const plot = homePage.whereYouStand.locator('[data-slot="chart"]');
      await plot.scrollIntoViewIfNeeded();
      const labels = plot.locator('.recharts-xAxis-tick-labels text');
      const start = await boxOf(labels.first());
      const end = await boxOf(labels.last());
      const box = await boxOf(plot);
      const y = Math.round(box.y + box.height / 2);
      const x = Math.round(start.x + start.width / 2);
      const tooltip = plot.locator('.recharts-tooltip-wrapper');
      const url = page.url();
      const touch = await context.newCDPSession(page);
      await touch.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y}]});
      await expect(tooltip).not.toBeVisible();
      await expect(tooltip).toBeVisible();
      await expect(tooltip).toContainText('June 2026');
      const pulses = Number(await page.locator('html').getAttribute('data-chart-pulses'));
      expect(pulses).toBeGreaterThan(0);
      await touch.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{x: Math.round(end.x + end.width / 2), y}],
      });
      await expect(tooltip).toContainText('November 2026');
      await expect(page.locator('html')).toHaveAttribute('data-chart-pulses', String(pulses + 1));
      const readout = await boxOf(tooltip);
      expect(readout.x).toBeGreaterThanOrEqual(0);
      expect(readout.x + readout.width).toBeLessThanOrEqual(390);
      await touch.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
      await expect(tooltip).not.toBeVisible();
      await expect(page).toHaveURL(url);
    });
  }

  test('sliding along the line reads the month under the finger and opens nothing', async ({
    page,
    context,
    homePage,
  }) => {
    await mockSyntheticHome(page);
    await page.goto('/');
    const chart = homePage.whereYouStand.locator('[data-slot="chart"]');
    await chart.scrollIntoViewIfNeeded();
    const start = (await monthSlot(chart, 5, 14)).centre;
    const end = (await monthSlot(chart, 10, 14)).centre;
    const tooltip = homePage.whereYouStand.locator('.recharts-tooltip-wrapper');
    const url = page.url();
    const touch = await context.newCDPSession(page);
    await touch.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [start]});
    // Five slots along in steps narrower than a slot, as a finger slides.
    for (let step = 1; step <= 10; step++) {
      await touch.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{x: Math.round(start.x + ((end.x - start.x) * step) / 10), y: start.y}],
      });
    }
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('August 2026');
    await expect(tooltip).toContainText('Balance');
    await expect(tooltip).toContainText('Kept+€1,000');
    await expect(homePage.whereYouStand.locator('.recharts-active-dot')).toBeVisible();
    // The month under the finger is marked across its whole slot.
    const august = await monthSlot(chart, 10, 14);
    const band = await boxOf(homePage.whereYouStand.locator('[data-slot="month-band"]'));
    expect(Math.abs(band.x - august.x)).toBeLessThanOrEqual(1);
    // Along the line's month labels, below the plot, the readout still follows the finger.
    const plot = await boxOf(chart);
    const labels = Math.round(plot.y + plot.height - 6);
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{x: end.x, y: labels}],
    });
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{x: start.x, y: labels}],
    });
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('March 2026');
    const readout = await boxOf(tooltip);
    expect(readout.x).toBeGreaterThanOrEqual(0);
    expect(readout.x + readout.width).toBeLessThanOrEqual(390);

    await touch.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
    await expect(tooltip).not.toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL(url);
  });

  test('vertical gestures scroll the page and cancellation ends inspection', async ({
    page,
    context,
    homePage,
  }) => {
    await mockSyntheticHome(page);
    await page.goto('/');
    const plot = homePage.whereYouStand.locator('[data-slot="chart"]');
    const tooltip = plot.locator('.recharts-tooltip-wrapper');
    const touch = await context.newCDPSession(page);
    // An upward swipe on the line scrolls the page.
    await plot.scrollIntoViewIfNeeded();
    const box = await boxOf(plot);
    const x = Math.round(box.x + box.width / 2);
    const y = Math.round(box.y + box.height / 2);
    const before = await page.evaluate(() => window.scrollY);
    await touch.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y}]});
    for (const distance of [20, 50, 90]) {
      await touch.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{x, y: y - distance}],
      });
    }
    await touch.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
    await expect(tooltip).not.toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await plot.scrollIntoViewIfNeeded();
    const next = await boxOf(plot);
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{x, y: Math.round(next.y + next.height / 2)}],
    });
    await expect(tooltip).toBeVisible();
    await touch.send('Input.dispatchTouchEvent', {type: 'touchCancel', touchPoints: []});
    await expect(tooltip).not.toBeVisible();
    await expect(plot).toHaveCSS('touch-action', 'pan-y pinch-zoom');
  });
});
