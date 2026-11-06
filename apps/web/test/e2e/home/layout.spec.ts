import type {Locator, Page} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';

import {
  MARKET_ID,
  RENT_KEY,
  USUAL_SPENDING,
  homeHistory,
  homeRecurring,
  mockSyntheticHome,
  monthTransactions,
} from '../../data/home-history.data';
import {expect, test} from '../../fixtures';
import {fulfillJson} from '../../utils/api-mocks';
import {boxOf, expectLoaded, expectNoHorizontalOverflow} from '../../utils/layout';

const layouts = [
  {width: 1440, theme: 'light'},
  {width: 1440, theme: 'dark'},
  {width: 1280, theme: 'light'},
  {width: 1024, theme: 'dark'},
  {width: 768, theme: 'light'},
  {width: 430, theme: 'dark'},
  {width: 390, theme: 'light'},
  {width: 390, theme: 'dark'},
  {width: 360, theme: 'light'},
  {width: 320, theme: 'dark'},
] as const;

const LONG_SOURCE = 'INCOME:example payroll';
const SCALE = 1000;
const FIRST_MONTH = '2007-01';

/**
 * Worst-case Home: twenty years of history, every amount a thousand times the demo's (balances in the tens of
 * millions) and forty income sources, one with a long legal name, all synthetic.
 */
function worstCase() {
  const spending = (month: string): Record<string, number> => {
    const base: Record<string, number> =
      month === '2026-11' ? {HOUSING_AND_UTILITIES: 1200} : {...USUAL_SPENDING};
    if (month === '2026-03') base.TRAVEL = 1500;
    if (month === '2025-09') Object.assign(base, {SHOPPING: 2600, HEALTH: 900});
    return Object.fromEntries(Object.entries(base).map(([key, value]) => [key, value * SCALE]));
  };
  const income = (month: string): Record<string, number> => {
    if (month === '2026-11') return {};
    const sources: Record<string, number> = {[LONG_SOURCE]: 2900 * SCALE};
    for (let index = 1; index <= 39; index++)
      sources[`INCOME:example source ${index}`] = index * 10;
    if (month === '2025-06') sources['INCOME:example bonus'] = 4000 * SCALE;
    return sources;
  };
  const sourceLabels: Record<string, string> = {
    [LONG_SOURCE]: 'Example International Holdings Netherlands B.V. Payroll Department',
  };
  for (let index = 1; index <= 39; index++)
    sourceLabels[`INCOME:example source ${index}`] = `Example Source ${index}`;
  return homeHistory({spending, income, sourceLabels, firstMonth: FIRST_MONTH});
}

test.use({storageState: {cookies: [], origins: []}, timezoneId: 'Europe/Amsterdam'});

/** Visible amounts that are cut short, run out of their box or break across lines. */
const brokenAmounts = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('main .numeric, [role="dialog"] .numeric'))
      .filter((element) => element.offsetParent !== null && element.children.length === 0)
      .filter((element) => !element.closest('svg'))
      .filter((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        // Text on more than one line has client rects at more than one height.
        const lines = new Set(
          Array.from(range.getClientRects()).map((rect) => Math.round(rect.bottom)),
        );
        if (lines.size > 1) return true;
        // The text stays inside every box around it, up to the one that scrolls or clips.
        const text = range.getBoundingClientRect();
        for (let box: HTMLElement | null = element; box; box = box.parentElement) {
          const overflow = getComputedStyle(box).overflowX;
          if (overflow === 'auto' || overflow === 'scroll') return false;
          const rect = box.getBoundingClientRect();
          if (text.left < rect.left - 1 || text.right > rect.right + 1) return true;
          if (overflow !== 'visible') return false;
        }
        return false;
      })
      .map((element) => element.textContent),
  );

/**
 * Visible links and buttons under 44px in either direction, inside `selector`. A kept bar is as wide as its month's
 * slot in the chart; the year table opens the same months.
 */
const smallTargets = (page: Page, selector: string) =>
  page.evaluate(
    (root) =>
      Array.from(document.querySelectorAll<HTMLElement>(`${root} a, ${root} button`))
        .filter((element) => element.offsetParent !== null)
        .filter((element) => !element.closest('[aria-label="Kept each month"]'))
        .filter((element) => {
          const box = element.getBoundingClientRect();
          return box.height < 43.5 || box.width < 43.5;
        })
        .map((element) => element.getAttribute('aria-label') ?? element.textContent?.trim()),
    selector,
  );

for (const [name, history] of [
  ['demo', homeHistory],
  ['worst-case', worstCase],
] as const) {
  for (const {width, theme} of layouts) {
    test(`Home and a month fit ${name} data at ${width}px in ${theme}`, async ({
      page,
      homePage,
    }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.setViewportSize({width, height: 1000});
      await page.addInitScript((value) => localStorage.setItem('vite-ui-theme', value), theme);
      await mockSyntheticHome(page, {history: history()});
      await page.goto('/');
      await expect(page.getByRole('region', {name: 'Income by source'})).toBeVisible();
      await expectLoaded(page);
      await page.evaluate(() => document.fonts.ready);
      const capture = async (view: string) => {
        if (!process.env.HOME_POLISH_CAPTURE_DIR) return;
        await mkdir(process.env.HOME_POLISH_CAPTURE_DIR, {recursive: true});
        await page.screenshot({
          path: join(process.env.HOME_POLISH_CAPTURE_DIR, `${view}-${name}-${theme}-${width}.png`),
          fullPage: view !== 'month',
        });
      };
      await capture('home');
      await expectNoHorizontalOverflow(page);
      expect.soft(await brokenAmounts(page)).toEqual([]);
      // Every control is a full tap target on a phone.
      if (width < 640) {
        expect.soft(await smallTargets(page, 'main')).toEqual([]);
        // An opened row lists every year, the tightest place for an amount.
        for (const title of ['Spending by category', 'Income by source']) {
          const table = page.getByRole('region', {name: title});
          await table.getByRole('button', {name: /^Total/}).click();
          await expect(table.getByRole('list', {name: /by year$/})).toHaveCount(1);
        }
        expect.soft(await brokenAmounts(page)).toEqual([]);
        expect.soft(await smallTargets(page, 'main')).toEqual([]);
      }

      await homePage.whereYouStand.getByRole('button', {name: 'All', exact: true}).click();
      await capture('home-all');
      await expectNoHorizontalOverflow(page);
      expect.soft(await brokenAmounts(page)).toEqual([]);

      await page.goto('/?month=2025-09');
      const dialog = homePage.monthDialog('September 2025');
      await expect(dialog.getByRole('region', {name: 'Biggest merchants'})).toBeVisible();
      await expectLoaded(dialog);
      await capture('month');
      expect.soft(await brokenAmounts(page)).toEqual([]);
      if (width < 640) expect.soft(await smallTargets(page, '[role="dialog"]')).toEqual([]);
      const sections = await dialog.evaluate((element) =>
        Array.from(element.querySelectorAll('section'))
          .filter((section) => section.scrollWidth > section.clientWidth + 1)
          .map((section) => section.getAttribute('aria-label')),
      );
      expect.soft(sections).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}

/** How far the chart column and the details column end apart, in px. */
async function columnGap(page: Page) {
  const card = page.getByRole('region', {name: 'Where you stand'});
  const [kept, details, repeats] = await Promise.all([
    boxOf(card.getByRole('list', {name: 'Kept each month'})),
    boxOf(card.getByRole('region', {name: 'This span'})),
    card
      .getByRole('region', {name: 'Repeats'})
      .boundingBox()
      .catch(() => null),
  ]);
  // Side by side, the details to the right of the bars.
  expect(details.x).toBeGreaterThanOrEqual(kept.x + kept.width);
  const right = repeats ?? details;
  return Math.abs(right.y + right.height - (kept.y + kept.height));
}

for (const width of [1000, 1024, 1440]) {
  test(`the chart and the span details end level at ${width}px, at every span`, async ({
    page,
    homePage,
  }) => {
    await page.setViewportSize({width, height: 1000});
    for (const [name, history] of [
      ['demo', homeHistory],
      ['worst-case', worstCase],
    ] as const) {
      await mockSyntheticHome(page, {history: history()});
      await page.goto('/');
      await expectLoaded(homePage.whereYouStand);
      for (const span of ['6M', '1Y', '3Y', 'All']) {
        await homePage.whereYouStand.getByRole('button', {name: span, exact: true}).click();
        await expect(homePage.whereYouStand.getByRole('region', {name: 'This span'})).toBeVisible();
        expect.soft(await columnGap(page), `${name}, ${span}`).toBeLessThanOrEqual(8);
      }
    }
  });
}

for (const {width, rows} of [
  {width: 390, rows: [2, 2]},
  {width: 1440, rows: [4]},
]) {
  test(`a month's figures are one card in four cells, ${rows.join(' by ')} at ${width}px`, async ({
    page,
    homePage,
  }) => {
    await page.setViewportSize({width, height: 900});
    await mockSyntheticHome(page);
    await page.goto('/?month=2026-03');

    const figures = homePage.monthDialog('March 2026').getByRole('region', {name: 'The month'});
    await expectLoaded(figures);
    const card = await boxOf(figures);
    const cells = await figures.evaluate((element) =>
      Array.from(element.children).map((cell) => {
        const box = cell.getBoundingClientRect();
        return {x: Math.round(box.x), y: Math.round(box.y), right: Math.round(box.right)};
      }),
    );
    expect(cells).toHaveLength(4);
    // Rows of cells, top to bottom, each as wide as the card and split by hairlines.
    const lines = [...new Set(cells.map((cell) => cell.y))];
    expect(lines.map((y) => cells.filter((cell) => cell.y === y).length)).toEqual(rows);
    for (const y of lines) {
      const line = cells.filter((cell) => cell.y === y);
      expect(line[0].x).toBe(Math.round(card.x) + 1);
      expect(line[line.length - 1].right).toBe(Math.round(card.x + card.width) - 1);
      for (let index = 1; index < line.length; index++)
        expect(line[index].x - line[index - 1].right).toBe(1);
    }
  });
}

test('Home’s text actions and Load more buttons share one style with the month’s, the Merchants’ and the Recurring ones, as do their transaction lists’ headings', async ({
  page,
  homePage,
}) => {
  await page.setViewportSize({width: 1440, height: 1000});
  await mockSyntheticHome(page, {transactionsPerMonth: 45});
  await page.goto('/');

  const style = (action: Locator) =>
    action.evaluate((element: HTMLElement) => {
      const css = getComputedStyle(element);
      return {
        font: `${css.fontSize} ${css.fontWeight}`,
        color: css.color,
        padding: css.padding,
        // Layout height, unaffected by a dialog's opening zoom.
        height: element.offsetHeight,
      };
    });
  const heading = (title: Locator) =>
    title.evaluate((element: HTMLElement) => {
      const css = getComputedStyle(element);
      return `${css.fontSize}/${css.lineHeight} ${css.fontWeight} ${css.color}`;
    });
  const card = homePage.whereYouStand;
  const spending = page.getByRole('region', {name: 'Spending by category'});
  const actions = [
    card.getByRole('button', {name: 'All recurring payments'}),
    card.getByRole('link', {name: 'Transactions in this span'}),
    spending.getByRole('button', {name: '3 more categories'}),
  ];
  const styles = [];
  for (const action of actions) styles.push(await style(action));
  await actions[2].click();
  styles.push(await style(spending.getByRole('button', {name: 'Show fewer'})));
  await page.goto('/?month=2026-03');
  const transactions = homePage
    .monthDialog('March 2026')
    .getByRole('region', {name: 'Transactions'});
  styles.push(await style(transactions.getByRole('link', {name: 'Open in Transactions'})));
  const headings = [await heading(transactions.getByRole('heading', {name: 'Transactions'}))];
  // Paged lists end in a full-width Load more.
  const loadMores = [await style(transactions.getByRole('button', {name: 'Load more'}))];

  // A merchant's and a recurring payment's transactions: more pages than one, opening in Transactions.
  await page.route(`**/merchants/${MARKET_ID}`, (route) =>
    fulfillJson(route, {
      id: MARKET_ID,
      name: 'Example Market',
      kind: 'MERCHANT',
      logoUrl: null,
      spent: '500.00',
      received: '0.00',
      count: 45,
      lastDate: '2026-10-28',
      baseCurrency: 'EUR',
      paid: '500.00',
      refunded: '0.00',
      paymentCount: 45,
      averagePayment: '11.11',
      firstDate: '2025-01-02',
      excluded: {unknownDirection: 0, missingBaseAmount: 0},
      variants: [],
    }),
  );
  await page.route(`**/merchants/${MARKET_ID}/periods?**`, (route) =>
    fulfillJson(route, {baseCurrency: 'EUR', interval: 'month', periods: []}),
  );
  await page.route('**/bank-transactions?**', (route) =>
    fulfillJson(route, {...monthTransactions('2026-10', 20), total: 45}),
  );
  await page.goto(`/?merchants=open&merchant=${MARKET_ID}`);
  const merchant = page.getByRole('dialog', {name: 'Merchants'});
  styles.push(await style(merchant.getByRole('link', {name: 'Open in Transactions'})));
  loadMores.push(await style(merchant.getByRole('button', {name: 'Load more'})));
  headings.push(await heading(merchant.getByRole('heading', {name: '45 transactions'})));
  await page.goto(`/?recurring=open&series=${RENT_KEY}`);
  const recurring = page.getByRole('dialog', {name: 'Recurring payments'});
  styles.push(
    await style(
      recurring
        .getByRole('region', {name: 'Payments'})
        .getByRole('link', {name: 'Open in Transactions'}),
    ),
  );
  loadMores.push(await style(recurring.getByRole('button', {name: 'Load more'})));
  headings.push(
    await heading(
      recurring
        .getByRole('region', {name: 'Payments'})
        .getByRole('heading', {name: 'All 45 payments'}),
    ),
  );
  // The recurring list's folds open like Home's "N more" rows.
  const {lists} = homeRecurring();
  const [rent, energy] = lists.expenses.series;
  lists.expenses.series.push(
    {...rent, key: 'd4'.repeat(16), name: 'Example Old Plan', status: 'ENDED'},
    {...energy, key: 'e5'.repeat(16), name: 'Example Hidden Plan', hidden: true, flags: []},
  );
  await page.route('**/recurring-series?**', (route) => fulfillJson(route, lists));
  await page.goto('/?recurring=open');
  styles.push(await style(recurring.getByText('Ended (1)', {exact: true})));
  styles.push(await style(recurring.getByText('Hidden (1)', {exact: true})));

  expect(styles[0].height).toBe(36);
  for (const item of styles) expect(item).toEqual(styles[0]);
  for (const item of loadMores) expect(item).toEqual(loadMores[0]);
  for (const item of headings) expect(item).toEqual(headings[0]);
});
