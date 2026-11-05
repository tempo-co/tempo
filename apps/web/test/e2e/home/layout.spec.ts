import type {BankTransactionEvent} from '@tempo/contracts';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';

import {
  HOME_EVENTS,
  USUAL_SPENDING,
  homeHistory,
  mockSyntheticHome,
} from '../../data/home-history.data';
import {expect, test} from '../../fixtures';
import {expectNoHorizontalOverflow} from '../../utils/layout';

const layouts = [
  {width: 1440, theme: 'light'},
  {width: 1440, theme: 'dark'},
  {width: 1280, theme: 'light'},
  {width: 1024, theme: 'dark'},
  {width: 768, theme: 'light'},
  {width: 390, theme: 'light'},
  {width: 390, theme: 'dark'},
  {width: 320, theme: 'dark'},
] as const;

const LONG_SOURCE = 'INCOME:example payroll';
const SCALE = 1000;

/**
 * Worst-case Home: every amount a thousand times the demo's (balances in the tens of millions), a
 * payroll source with a long legal name, a dozen small income sources, and a month with three long-named
 * one-offs, all synthetic.
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
    for (let index = 1; index <= 12; index++)
      sources[`INCOME:example source ${index}`] = index * 10;
    if (month === '2025-06') sources['INCOME:example bonus'] = 4000 * SCALE;
    return sources;
  };
  const longEvents: BankTransactionEvent[] = [
    ...HOME_EVENTS.map((event) => ({
      ...event,
      amount: (Number(event.amount) * SCALE).toFixed(2),
      usualMonth: (2000 * SCALE).toFixed(2),
    })),
    ...[
      'Example Furniture and Interior Design Warehouse Outlet',
      'Example Private Hospital and Specialist Clinic',
      'Exampleverylongmerchantnamewithoutanyspaces',
    ].map((name, index) => ({
      id: `00000000-0000-4000-8000-00000000f00${index}`,
      date: `2025-09-${10 + index}`,
      name,
      category: index === 1 ? ('HEALTH' as const) : ('SHOPPING' as const),
      direction: 'EXPENSE' as const,
      amount: (1200 * SCALE).toFixed(2),
      usualMonth: (2000 * SCALE).toFixed(2),
      share: 0.6,
    })),
  ];
  const sourceLabels: Record<string, string> = {
    [LONG_SOURCE]: 'Example International Holdings Netherlands B.V. Payroll Department',
  };
  for (let index = 1; index <= 12; index++)
    sourceLabels[`INCOME:example source ${index}`] = `Example Source ${index}`;
  return homeHistory({spending, income, events: longEvents, sourceLabels});
}

test.use({storageState: {cookies: [], origins: []}, timezoneId: 'Europe/Amsterdam'});

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
          fullPage: view === 'home',
        });
      };
      await capture('home');
      await expectNoHorizontalOverflow(page);

      // Controls are at least 44px tall on a phone.
      if (width < 640) {
        for (const button of await homePage.whereYouStand
          .getByRole('group', {name: 'Span'})
          .getByRole('button')
          .all())
          expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }

      // Amounts are never cut short or broken across lines.
      const brokenAmounts = () =>
        page.evaluate(() =>
          Array.from(
            document.querySelectorAll<HTMLElement>('main .numeric, [role="dialog"] .numeric'),
          )
            .filter((element) => element.offsetParent !== null && element.children.length === 0)
            .filter((element) => {
              // Text on more than one line has client rects at more than one height.
              const range = document.createRange();
              range.selectNodeContents(element);
              const lines = new Set(
                Array.from(range.getClientRects()).map((rect) => Math.round(rect.bottom)),
              );
              return element.scrollWidth > element.clientWidth + 1 || lines.size > 1;
            })
            .map((element) => element.textContent),
        );
      expect(await brokenAmounts()).toEqual([]);

      await page.goto('/?month=2025-09');
      const dialog = homePage.monthDialog('September 2025');
      await expect(dialog.getByRole('region', {name: 'Biggest merchants'})).toBeVisible();
      await capture('month');
      expect(await brokenAmounts()).toEqual([]);
      const sections = await dialog.evaluate((element) =>
        Array.from(element.querySelectorAll('section'))
          .filter((section) => section.scrollWidth > section.clientWidth + 1)
          .map((section) => section.getAttribute('aria-label')),
      );
      expect(sections).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}
