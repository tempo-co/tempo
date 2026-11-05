import type {Page} from '@playwright/test';
import type {BankTransactionEvent} from '@tempo/contracts';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';

import {
  HOME_EVENTS,
  USUAL_SPENDING,
  homeHistory,
  mockSyntheticHome,
  oneOffs,
} from '../../data/home-history.data';
import {expect, test} from '../../fixtures';
import {boxOf, expectNoHorizontalOverflow} from '../../utils/layout';

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
 * millions), forty income sources (one with a long legal name), and fifteen one-offs in the last year with long,
 * unbreakable and two-letter names, all synthetic.
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
  const events: BankTransactionEvent[] = [
    ...HOME_EVENTS.map((event) => ({
      ...event,
      amount: (Number(event.amount) * SCALE).toFixed(2),
      usualMonth: (2000 * SCALE).toFixed(2),
    })),
    ...oneOffs(15, SCALE),
  ];
  const sourceLabels: Record<string, string> = {
    [LONG_SOURCE]: 'Example International Holdings Netherlands B.V. Payroll Department',
  };
  for (let index = 1; index <= 39; index++)
    sourceLabels[`INCOME:example source ${index}`] = `Example Source ${index}`;
  return homeHistory({spending, income, events, sourceLabels, firstMonth: FIRST_MONTH});
}

test.use({storageState: {cookies: [], origins: []}, timezoneId: 'Europe/Amsterdam'});

/** Visible amounts that are cut short or broken across lines. */
const brokenAmounts = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('main .numeric, [role="dialog"] .numeric'))
      .filter((element) => element.offsetParent !== null && element.children.length === 0)
      .filter((element) => {
        // Text on more than one line has client rects at more than one height; cut text runs past its box.
        const range = document.createRange();
        range.selectNodeContents(element);
        const lines = new Set(
          Array.from(range.getClientRects()).map((rect) => Math.round(rect.bottom)),
        );
        const text = range.getBoundingClientRect();
        const box = element.getBoundingClientRect();
        return lines.size > 1 || text.left < box.left - 1 || text.right > box.right + 1;
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
      if (width < 640) expect.soft(await smallTargets(page, 'main')).toEqual([]);

      await homePage.whereYouStand.getByRole('button', {name: 'All', exact: true}).click();
      await capture('home-all');
      await expectNoHorizontalOverflow(page);
      expect.soft(await brokenAmounts(page)).toEqual([]);

      await page.goto('/?month=2025-09');
      const dialog = homePage.monthDialog('September 2025');
      await expect(dialog.getByRole('region', {name: 'Biggest merchants'})).toBeVisible();
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
  test(`the chart and the span details end level at ${width}px, whatever the one-offs`, async ({
    page,
    homePage,
  }) => {
    // Four histories, four spans each.
    test.setTimeout(60_000);
    await page.setViewportSize({width, height: 1000});
    for (const count of [0, 1, 2, 15]) {
      await mockSyntheticHome(page, {history: homeHistory({events: oneOffs(count)})});
      await page.goto('/');
      for (const span of ['6M', '1Y', '3Y', 'All']) {
        await homePage.whereYouStand.getByRole('button', {name: span, exact: true}).click();
        await expect(homePage.whereYouStand.getByRole('region', {name: 'This span'})).toBeVisible();
        expect.soft(await columnGap(page), `${count} one-offs, ${span}`).toBeLessThanOrEqual(48);
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
