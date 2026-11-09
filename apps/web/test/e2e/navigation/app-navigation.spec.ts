import type {BankTransaction} from '@tempo/contracts';

import {VERIFIED_USER_AUTH_FILE} from '../../constants/auth.constants';
import {
  HOME_REVIEW_COUNTS,
  mockSyntheticHome,
  monthTransactions,
} from '../../data/home-history.data';
import {expect, test} from '../../fixtures';
import {fulfillJson, mockJson} from '../../utils/api-mocks';
import {boxOf, expectNoHorizontalOverflow} from '../../utils/layout';

test.use({storageState: VERIFIED_USER_AUTH_FILE});

const destinations = [
  {label: 'Connections', url: /\/bank-connections$/},
  {label: 'Transactions', url: /\/bank-transactions(?:\?|$)/},
  {label: 'Settings', url: /\/settings\/account$/},
  {label: 'Home', url: /^https?:\/\/[^/]+\/(?:\?|$)/},
];

test('navigates between pages from the phone tab bar', async ({page}) => {
  await page.setViewportSize({width: 320, height: 700});
  await page.goto('/');

  const tabBar = page.getByTestId('app-tab-bar');
  await expect(tabBar).toBeVisible();
  await expect(page.getByRole('navigation', {name: 'Primary'})).toHaveCount(1);
  // Recurring payments live on Home, not in a tab of their own.
  await expect(tabBar.getByRole('link', {name: 'Recurring'})).toHaveCount(0);
  // The tabs share the whole bar, with no empty slot left over.
  const tabs = tabBar.getByRole('link');
  const last = await boxOf(tabs.last());
  const bar = await boxOf(tabBar);
  expect(last.x + last.width).toBeGreaterThanOrEqual(bar.x + bar.width - 1);

  for (const {label, url} of destinations) {
    const tab = tabBar.getByRole('link', {name: label});
    await tab.click();
    await expect(page).toHaveURL(url);
    await expect(tab).toHaveAttribute('aria-current', 'page');
    await expect(tabBar.locator('[aria-current="page"]')).toHaveCount(1);
    expect((await boxOf(tab)).height).toBeGreaterThanOrEqual(44);
  }

  // Nested settings pages keep the Settings tab active.
  await page.goto('/settings/appearance');
  await expect(tabBar.getByRole('link', {name: 'Settings'})).toHaveAttribute(
    'aria-current',
    'page',
  );

  // The page reserves room for the fixed tab bar, so the last content is never hidden behind it.
  const mainPadding = await page
    .locator('main')
    .evaluate((main) => parseFloat(getComputedStyle(main).paddingBottom));
  expect(mainPadding).toBeGreaterThanOrEqual((await boxOf(tabBar)).height);
  await expectNoHorizontalOverflow(page);
});

test('navigates from the header and account menu on wider screens', async ({page}) => {
  await page.setViewportSize({width: 1280, height: 800});
  await page.goto('/');

  await expect(page.getByTestId('app-tab-bar')).toBeHidden();
  const nav = page.getByRole('navigation', {name: 'Primary'});
  await expect(nav.getByRole('link', {name: 'Recurring'})).toHaveCount(0);
  await expect(nav.getByRole('link', {name: 'Home'})).toHaveAttribute('aria-current', 'page');

  await nav.getByRole('link', {name: 'Transactions'}).click();
  await expect(page).toHaveURL(/\/bank-transactions(?:\?|$)/);
  await expect(nav.getByRole('link', {name: 'Transactions'})).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(nav.getByRole('link', {name: 'Home'})).not.toHaveAttribute('aria-current');

  const accountMenuTrigger = page.getByTestId('account-menu-trigger');
  await expect(accountMenuTrigger).toHaveAccessibleName(/^Account menu, /);
  await accountMenuTrigger.click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();
  await expect(accountMenuTrigger).toBeFocused();

  await accountMenuTrigger.click();
  await page.getByRole('menuitem', {name: 'Settings'}).click();
  await expect(page).toHaveURL(/\/settings\/account$/);
  await expect(nav.locator('[aria-current="page"]')).toHaveCount(0);

  await page.getByRole('link', {name: 'Tempo home'}).click();
  await expect(page).toHaveURL(/^https?:\/\/[^/]+\/(?:\?|$)/);
});

test.describe('the Transactions badge away from Home', () => {
  test.use({storageState: {cookies: [], origins: []}, timezoneId: 'Europe/Amsterdam'});

  test('refreshes every five minutes, and right after a review on that page', async ({page}) => {
    await mockSyntheticHome(page, {clock: 'installed'});
    const [transaction] = monthTransactions('2026-10', 1).transactions;
    let saved: BankTransaction = {...transaction, category: null, categoryStatus: 'FAILED'};
    let reviewed = false;
    let reads = 0;
    await page.route('**/bank-transactions/review-counts', (route) => {
      reads++;
      return fulfillJson(
        route,
        reviewed
          ? {...HOME_REVIEW_COUNTS, categorizationFailed: 0, needsAttention: 2}
          : HOME_REVIEW_COUNTS,
      );
    });
    await page.route(`**/bank-transactions/${transaction.id}`, (route) =>
      fulfillJson(route, saved),
    );
    await page.route(`**/bank-transactions/${transaction.id}/category-impact?**`, (route) =>
      fulfillJson(route, {action: 'APPLY', category: 'TRAVEL', total: 0, transactions: []}),
    );
    await page.route(`**/bank-transactions/${transaction.id}/category`, (route) => {
      reviewed = true;
      saved = {...saved, category: 'TRAVEL', categoryStatus: 'COMPLETED', categorySource: 'MANUAL'};
      return fulfillJson(route, saved);
    });

    await mockJson(page, '**/bank-connections/aspsps', []);

    await page.goto('/bank-connections');
    const nav = page.getByRole('navigation', {name: 'Primary'}).first();
    await expect(nav.getByRole('link', {name: 'Transactions, 3 to review'})).toBeVisible();
    await expect.poll(() => reads).toBe(1);
    await page.clock.runFor(4 * 60_000);
    expect(reads).toBe(1);
    await page.clock.runFor(61_000);
    await expect.poll(() => reads).toBe(2);

    await page.goto(`/bank-transactions?transactionId=${transaction.id}`);
    await page.getByRole('combobox', {name: 'Transaction category'}).click();
    await page.getByRole('option', {name: 'Travel', exact: true}).click();
    await expect(page.getByRole('combobox', {name: 'Transaction category'})).toHaveText('Travel');
    await page.keyboard.press('Escape');
    await expect(nav.getByRole('link', {name: 'Transactions, 2 to review'})).toBeVisible();
  });
});

test.describe('the Tempo mark', () => {
  test.use({storageState: {cookies: [], origins: []}, timezoneId: 'Europe/Amsterdam'});

  for (const width of [390, 1440]) {
    test(`the header mark is 36px inside a 44px home link at ${width}px`, async ({page}) => {
      await page.setViewportSize({width, height: 844});
      await mockSyntheticHome(page);
      await page.goto('/');
      const header = await boxOf(page.getByRole('banner'));
      const link = page.getByRole('banner').getByRole('link', {name: 'Tempo home'});
      const target = await boxOf(link);
      const mark = await boxOf(link.locator('svg'));
      expect(target.width).toBeGreaterThanOrEqual(44);
      expect(target.height).toBeGreaterThanOrEqual(44);
      expect(mark.width).toBe(36);
      expect(mark.height).toBe(36);
      // The header keeps its 48px row and bottom border, and the mark sits in the row's middle and at its inset.
      expect(header.height).toBe(49);
      expect(Math.abs(mark.y + mark.height / 2 - (header.y + 24))).toBeLessThanOrEqual(1);
      expect(target.y).toBeGreaterThanOrEqual(header.y);
      expect(mark.x).toBe(width >= 1280 ? (width - 1280) / 2 + 16 : 16);

      await link.click();
      await expect(page).toHaveURL(/^https?:\/\/[^/]+\/(?:\?|$)/);
    });
  }

  test('auth pages show the mark at 48px', async ({page}) => {
    await page.setViewportSize({width: 390, height: 844});
    await page.route('**/accounts/me', (route) =>
      fulfillJson(route, {message: 'Unauthorized'}, 401),
    );
    await page.goto('/login');
    const mark = await boxOf(page.getByRole('link', {name: 'Tempo home'}).locator('svg'));
    expect(mark.width).toBe(48);
    expect(mark.height).toBe(48);
  });
});
