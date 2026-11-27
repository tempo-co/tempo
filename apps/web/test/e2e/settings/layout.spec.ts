import type {Locator, Page} from '@playwright/test';
import type {BankTransactionBreakdown, BankTransactionBreakdownPart} from '@wisp/contracts';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';

import {createAccount} from '../../data/account.data';
import {expect, test} from '../../fixtures';
import {fulfillJson, mockJson} from '../../utils/api-mocks';
import {boxOf, expectNoHorizontalOverflow} from '../../utils/layout';

test.use({storageState: {cookies: [], origins: []}});

type Counts = Record<string, number>;

/**
 * Demo: a year and a half of everyday spending. Worst case, all synthetic: twenty years of a busy household, with six
 * digits in the biggest category, one transaction in another, rows without a category, a long hyphenated name with
 * diacritics and an email at a long company domain.
 */
const data = {
  demo: {
    account: createAccount({name: 'Alex Example', email: 'alex@example.com'}),
    years: [
      {GROCERIES: 96, EATING_OUT: 31, SHOPPING: 14, HOUSING_AND_UTILITIES: 24, REFUND: 2},
      {GROCERIES: 48, EATING_OUT: 17, TRANSPORTATION: 9, HOUSING_AND_UTILITIES: 12},
    ] as Counts[],
  },
  'worst-case': {
    account: createAccount({
      name: 'Aleksandra Wiśniewska-Kowalczyk von Hohenberg-Ostrowska',
      email: 'bartholomew.fitzgerald@northwind-industries-holdings.example.com',
    }),
    years: Array.from({length: 20}, (_, year): Counts => ({
      GROCERIES: 6420 + year,
      INCOME: 26,
      TRANSFER_IN: 52,
      HOUSING_AND_UTILITIES: 480,
      TAXES_AND_GOVERNMENT: 120,
      GIFTS_AND_DONATIONS: 75,
      LOANS_AND_DEBT: 60,
      CASH_WITHDRAWAL: 40,
      NEEDS_REVIEW: 3000,
      UNCATEGORIZED: 4999,
      ...(year === 0 ? {EDUCATION: 1} : {}),
    })),
  },
};

function breakdown(years: Counts[], today: string): BankTransactionBreakdown {
  const first = Number(today.slice(0, 4)) - years.length + 1;
  return {
    baseCurrency: 'EUR',
    interval: 'year',
    by: 'allCategories',
    periods: years.map((counts, index) => {
      const parts: BankTransactionBreakdownPart[] = Object.entries(counts).map(([key, count]) => ({
        key,
        label: key,
        amount: (count * 10).toFixed(2),
        count,
      }));
      return {
        start: `${first + index}-01-01`,
        end: index === years.length - 1 ? today : `${first + index}-12-31`,
        complete: index < years.length - 1,
        total: parts.reduce((sum, part) => sum + Number(part.amount), 0).toFixed(2),
        parts,
      };
    }),
  };
}

/** Links and buttons inside `root` smaller than a 44px tap target. */
const smallTargets = (root: Locator) =>
  root.evaluate((element) =>
    Array.from(element.querySelectorAll<HTMLElement>('a, button'))
      .filter((child) => child.offsetParent !== null)
      .filter((child) => {
        const box = child.getBoundingClientRect();
        return box.height < 43.5 || box.width < 43.5;
      })
      .map((child) => child.getAttribute('aria-label') ?? child.textContent?.trim()),
  );

/** Each row's count: on one line, whole, and inside its row past the name. */
const countFits = (list: Locator) =>
  list.getByRole('listitem').evaluateAll((rows) =>
    rows
      .map((row) => {
        const count = row.lastElementChild as HTMLElement;
        const name = row.firstElementChild as HTMLElement;
        const box = row.getBoundingClientRect();
        const countBox = count.getBoundingClientRect();
        const nameBox = name.getBoundingClientRect();
        const lineHeight = parseFloat(getComputedStyle(count).lineHeight);
        return {
          text: row.textContent,
          fits:
            countBox.height <= lineHeight + 0.5 &&
            count.scrollWidth <= count.clientWidth + 0.5 &&
            countBox.right <= box.right &&
            nameBox.right <= countBox.left,
        };
      })
      .filter((row) => !row.fits)
      .map((row) => row.text),
  );

async function capture(page: Page, view: string) {
  if (!process.env.SETTINGS_CAPTURE_DIR) return;
  await mkdir(process.env.SETTINGS_CAPTURE_DIR, {recursive: true});
  await page.screenshot({
    path: join(process.env.SETTINGS_CAPTURE_DIR, `${view}.png`),
    // A full-page capture would paint the phone tab bar mid-page.
    fullPage: page.viewportSize()!.width >= 768,
  });
}

for (const [name, {account, years}] of Object.entries(data)) {
  for (const {width, theme} of [
    {width: 1440, theme: 'light'},
    {width: 1440, theme: 'dark'},
    {width: 390, theme: 'light'},
    {width: 390, theme: 'dark'},
    {width: 320, theme: 'light'},
    {width: 320, theme: 'dark'},
  ] as const) {
    test(`Settings fits ${name} data at ${width}px in ${theme}`, async ({page}) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.setViewportSize({width, height: 900});
      await page.addInitScript((value) => localStorage.setItem('vite-ui-theme', value), theme);
      await mockJson(page, '**/accounts/me', account);
      await mockJson(page, '**/auth/sessions', []);
      await page.route('**/bank-transactions/breakdown?**', (route) => {
        const today = new URL(route.request().url()).searchParams.get('to')!;
        return fulfillJson(route, breakdown(years, today));
      });
      const phone = width < 768;
      const main = page.getByRole('main');

      if (phone) {
        // The list to tap into: whole rows, each a full tap target.
        await page.goto('/settings');
        const list = page.getByRole('navigation', {name: 'Settings sections'});
        await expect(list).toBeVisible();
        await capture(page, `list-${name}-${theme}-${width}`);
        await expectNoHorizontalOverflow(page);
        expect.soft(await smallTargets(list)).toEqual([]);
      }

      // Profile: a long name and email wrap inside their rows, and every Change stays whole beside them.
      await page.goto('/settings/profile');
      await expect(page.getByTestId('edit-name-button')).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await capture(page, `profile-${name}-${theme}-${width}`);
      await expectNoHorizontalOverflow(page);
      const column = await boxOf(main.getByRole('heading', {level: phone ? 1 : 2}));
      for (const id of ['edit-name-button', 'change-email-button']) {
        const button = await boxOf(page.getByTestId(id));
        expect.soft(button.x + button.width, id).toBeLessThanOrEqual(width - 16);
      }
      if (phone) expect.soft(await smallTargets(main)).toEqual([]);
      else {
        // The section list and the open section side by side, the section's title level with the list's first row.
        const nav = await boxOf(page.getByRole('navigation', {name: 'Settings sections'}));
        expect(column.x).toBeGreaterThan(nav.x + nav.width);
        expect(Math.abs(column.y - nav.y)).toBeLessThan(8);
      }

      // Categories: every count whole on one line beside its name.
      await page.goto('/settings/categories');
      const list = page.getByRole('list', {name: 'All categories'});
      await expect(list).not.toHaveAttribute('aria-busy');
      await capture(page, `categories-${name}-${theme}-${width}`);
      await expectNoHorizontalOverflow(page);
      expect.soft(await countFits(list)).toEqual([]);
      if (name === 'worst-case') {
        await expect(list.getByRole('listitem').filter({hasText: 'Groceries'})).toHaveText(
          /128,590$/,
        );
        await expect(list.getByRole('listitem').last()).toHaveText(/^Not categorized\s*99,980$/);
      }
      expect(errors).toEqual([]);
    });
  }
}
