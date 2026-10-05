import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';

import {VERIFIED_USER_AUTH_FILE} from '../../constants/auth.constants';
import {SEEDED_TRANSACTION_YEAR_NOW} from '../../constants/seed.constants';
import {categorySummary} from '../../data/home-categories.data';
import {firstMonthSummary} from '../../data/home-summary.data';
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
    expect(firstBox.y - (headerBox.y + headerBox.height)).toBeGreaterThanOrEqual(20);
    expect(cardBox.y + cardBox.height - (lastBox.y + lastBox.height)).toBeGreaterThanOrEqual(20);

    for (const link of [
      balances.getByRole('link', {name: 'Connections'}),
      recent.getByRole('link', {name: 'View all'}),
    ]) {
      expect((await boxOf(link)).height).toBeGreaterThanOrEqual(44);
    }

    // The comparison is right-aligned only when it actually sits beside the headline.
    const spending = page.getByTestId('spending-summary');
    const comparison = spending.getByTestId('spending-comparison');
    const headline = await boxOf(spending.getByRole('link').first());
    const comparisonBox = await boxOf(comparison);
    const beside = comparisonBox.y < headline.y + headline.height;
    expect(await comparison.evaluate((element) => getComputedStyle(element).textAlign)).toBe(
      beside ? 'right' : 'start',
    );

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

test('the spending chart shows keyboard focus', async ({page}) => {
  await page.clock.setFixedTime(SEEDED_TRANSACTION_YEAR_NOW);
  await page.goto('/?month=2026-08');
  const surface = page.getByTestId('spending-summary').locator('.recharts-surface[tabindex="0"]');
  await surface.focus();
  const outline = await surface.evaluate((element) => {
    const style = getComputedStyle(element);
    return {style: style.outlineStyle, width: parseFloat(style.outlineWidth)};
  });
  expect(outline.style).toBe('solid');
  expect(outline.width).toBeGreaterThanOrEqual(2);
});

test('a narrow first-month view contains the hidden and keyboard-revealed daily table', async ({
  page,
}) => {
  await page.setViewportSize({width: 320, height: 844});
  await page.clock.setFixedTime(SEEDED_TRANSACTION_YEAR_NOW);
  await mockJson(page, '**/bank-transactions/summary**', firstMonthSummary);
  await page.goto('/?month=2026-09');
  await expect(page.getByTestId('spending-summary')).toContainText(
    'No earlier months to compare with yet.',
  );
  await expectNoHorizontalOverflow(page);
  const table = page.getByRole('table', {name: 'Exact daily spending'});
  const wrapper = table.locator('..');
  const day = table.getByRole('link', {name: '1 Sep', exact: true});
  const hiddenBox = await boxOf(wrapper);
  expect(hiddenBox.width).toBe(1);
  expect(hiddenBox.height).toBe(1);
  expect(await wrapper.evaluate((element) => getComputedStyle(element).overflow)).toBe('hidden');
  const surface = page.getByTestId('spending-summary').locator('.recharts-surface[tabindex="0"]');
  await surface.focus();
  await page.keyboard.press('Tab');
  await expect(day).toBeFocused();
  const revealedBox = await boxOf(wrapper);
  expect(revealedBox.width).toBeGreaterThan(100);
  expect(revealedBox.height).toBeGreaterThan(100);
  expect(await wrapper.evaluate((element) => getComputedStyle(element).clip)).toBe('auto');
  await expectNoHorizontalOverflow(page);
  await page.getByRole('link', {name: 'Previous month'}).focus();
  expect((await boxOf(wrapper)).height).toBe(1);
  await surface.focus();
  await page.keyboard.press('Tab');
  await expect(day).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/bank-transactions/);
  const filter = JSON.parse(new URL(page.url()).searchParams.get('bookingDate')!) as {
    from: string;
    to: string;
  };
  const localMidnight = await page.evaluate(() => new Date(2026, 8, 1).toISOString());
  expect(filter).toEqual({from: localMidnight, to: localMidnight});
});

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

for (const theme of ['light', 'dark']) {
  test(`chart axes use readable theme text in ${theme}`, async ({page}) => {
    await page.addInitScript((value) => localStorage.setItem('vite-ui-theme', value), theme);
    await page.goto('/?month=2026-08');
    const summary = page.getByTestId('spending-summary');
    const period = summary.getByText('spent in August 2026', {exact: true});
    await expect(period).toBeVisible();
    const expectedColor = await period.evaluate((element) => getComputedStyle(element).color);
    const labels = summary.locator('.recharts-cartesian-axis-tick-value');
    expect(await labels.count()).toBeGreaterThan(0);
    const fills = await labels.evaluateAll((elements) =>
      elements.map((element) => getComputedStyle(element).fill),
    );
    for (const fill of fills) expect(fill).toBe(expectedColor);
  });
}
