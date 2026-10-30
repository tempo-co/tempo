import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';

import {VERIFIED_USER_AUTH_FILE} from '../../constants/auth.constants';
import {SEEDED_TRANSACTION_YEAR_NOW} from '../../constants/seed.constants';
import {categorySummary} from '../../data/home-categories.data';
import {expect, test} from '../../fixtures';
import {mockJson, transformBankConnections} from '../../utils/api-mocks';
import {boxOf, expectNoHorizontalOverflow} from '../../utils/layout';

const layouts = [
  {width: 1440, theme: 'light'},
  {width: 1440, theme: 'dark'},
  {width: 768, theme: 'dark'},
  {width: 1100, theme: 'light'},
  {width: 390, theme: 'light'},
  {width: 390, theme: 'dark'},
  {width: 320, theme: 'dark'},
] as const;

test.use({storageState: VERIFIED_USER_AUTH_FILE});
test.afterEach(async ({page}) => {
  await page.unrouteAll({behavior: 'wait'});
});

for (const {width, theme} of layouts) {
  test(`Home keeps readable gutters and spacing at ${width}px in ${theme}`, async ({page}) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({width, height: 1000});
    await page.clock.setFixedTime(SEEDED_TRANSACTION_YEAR_NOW);
    await page.addInitScript((value) => localStorage.setItem('vite-ui-theme', value), theme);
    await mockJson(page, '**/bank-transactions/summary**', {
      ...categorySummary,
      month: '2026-08',
      through: '2026-08-31',
    });
    await mockJson(page, '**/bank-transactions/review-counts', {
      needsReview: 2,
      categorizationFailed: 3,
      categorizing: 4,
      unknownDirection: 5,
      missingBaseAmount: 6,
    });
    await transformBankConnections(page, (connections) =>
      connections.map((connection) => ({
        ...connection,
        aspspName: 'Example Bank with a longer display name',
        baseCurrency: 'EUR',
        bankAccounts: connection.bankAccounts.map((account, index) => ({
          ...account,
          alias:
            index === 0
              ? 'Example household expenses and everyday spending account'
              : account.alias,
          currency: 'USD',
          currentBalanceAmount: '125.00',
          currentBalanceInBaseCurrency: '100.00',
          baseCurrencyRateDate: '2026-08-25',
        })),
      })),
    );
    await page.goto('/?month=2026-08');
    const balances = page.getByRole('region', {name: 'Balances'});
    const recent = page.getByRole('region', {name: 'Latest in August 2026'});
    const attention = page.getByRole('region', {name: 'Needs attention', exact: true});
    const categories = page.getByTestId('category-breakdown');
    await expect(recent.getByRole('link', {name: /Coffee shop/})).toBeVisible();
    await expect(categories.getByRole('link', {name: /Housing and utilities/})).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    if (process.env.HOME_POLISH_CAPTURE_DIR) {
      await mkdir(process.env.HOME_POLISH_CAPTURE_DIR, {recursive: true});
      await page.screenshot({
        path: join(process.env.HOME_POLISH_CAPTURE_DIR, `home-${theme}-${width}.png`),
        fullPage: true,
      });
    }

    const ringColor = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.color = 'hsl(var(--ring))';
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    });
    for (const card of [balances, recent, attention]) {
      const links = card.locator('li a');
      expect(await links.count()).toBeGreaterThan(0);
      for (const link of await links.all()) {
        const padding = await link.evaluate((element) => {
          const style = getComputedStyle(element);
          return {left: parseFloat(style.paddingLeft), right: parseFloat(style.paddingRight)};
        });
        expect(padding.left).toBeGreaterThanOrEqual(12);
        expect(padding.right).toBeGreaterThanOrEqual(12);
        await link.focus();
        const outline = await link.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            style: style.outlineStyle,
            width: parseFloat(style.outlineWidth),
            color: style.outlineColor,
          };
        });
        expect(outline.style).toBe('solid');
        expect(outline.width).toBeGreaterThanOrEqual(2);
        expect(outline.color).toBe(ringColor);
      }
    }
    const heading = categories.getByRole('heading', {name: 'Where it went'});
    const description = heading.locator('..');
    const firstCategory = categories.getByRole('link', {name: /Housing and utilities/});
    const lastRow = categories.getByRole('link', {name: /Refunds \(subtracted\)/});
    const headerBox = await boxOf(description);
    const firstBox = await boxOf(firstCategory);
    const cardBox = await boxOf(categories);
    const lastBox = await boxOf(lastRow);
    // Every Home card leaves the same 16px between its header and content.
    expect(firstBox.y - (headerBox.y + headerBox.height)).toBeGreaterThanOrEqual(16);
    expect(cardBox.y + cardBox.height - (lastBox.y + lastBox.height)).toBeGreaterThanOrEqual(20);

    for (const link of [
      balances.getByRole('link', {name: 'Connections'}),
      recent.getByRole('link', {name: 'View all'}),
    ]) {
      expect((await boxOf(link)).height).toBeGreaterThanOrEqual(44);
    }

    const month = await boxOf(page.getByRole('heading', {level: 1}));
    const previous = await boxOf(page.getByRole('link', {name: 'Previous month'}));
    const next = await boxOf(page.getByRole('link', {name: 'Next month'}));
    expect(month.x - (previous.x + previous.width)).toBeGreaterThanOrEqual(12);
    expect(next.x - (month.x + month.width)).toBeGreaterThanOrEqual(12);
    expect(previous.height).toBeGreaterThanOrEqual(44);
    expect(next.height).toBeGreaterThanOrEqual(44);
    expect(previous.y).toBe(next.y);
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });
}

for (const theme of ['light', 'dark']) {
  test(`sync-problem badges use readable foreground text in ${theme}`, async ({page}) => {
    await page.clock.setFixedTime(SEEDED_TRANSACTION_YEAR_NOW);
    await page.addInitScript((value) => localStorage.setItem('vite-ui-theme', value), theme);
    await transformBankConnections(page, (connections) =>
      connections.map((connection) => ({...connection, syncStatus: 'FAILED'})),
    );
    await page.goto('/?month=2026-08');
    const badge = page
      .getByTestId('home-sync-status')
      .locator('span')
      .filter({hasText: 'has not synced since'})
      .first();
    await expect(badge).toBeVisible();
    expect(await badge.evaluate((element) => getComputedStyle(element).color)).toBe(
      await page.evaluate(() => getComputedStyle(document.body).color),
    );
  });
}
