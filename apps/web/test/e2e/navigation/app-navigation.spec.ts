import type {BankTransaction} from '@wisp/contracts';

import {
  HOME_REVIEW_COUNTS,
  mockSyntheticHome,
  monthTransactions,
} from '../../data/home-history.data';
import {expect, test} from '../../fixtures';
import {fulfillJson, mockJson} from '../../utils/api-mocks';
import {boxOf} from '../../utils/layout';

test.describe('the Transactions badge away from Home', () => {
  test.use({storageState: {cookies: [], origins: []}, timezoneId: 'Europe/Amsterdam'});

  for (const {needsAttention, text} of [
    {needsAttention: 3, text: '3'},
    {needsAttention: 120, text: '99+'},
  ]) {
    test(`shows ${text} to check in a round badge`, async ({page}) => {
      await mockSyntheticHome(page, {reviewCounts: {...HOME_REVIEW_COUNTS, needsAttention}});
      await mockJson(page, '**/bank-connections/aspsps', []);
      await page.goto('/accounts');
      const badge = page
        .getByRole('navigation', {name: 'Primary'})
        .first()
        .getByRole('link', {name: `Transactions, ${needsAttention} to check`})
        .getByText(text, {exact: true});
      const box = await boxOf(badge);
      // Fully rounded ends: a circle for one digit, a pill for more.
      expect(
        parseFloat(
          await badge.evaluate((element) => getComputedStyle(element).borderTopLeftRadius),
        ),
      ).toBeGreaterThanOrEqual(box.height / 2);
      if (text.length === 1) expect(box.width).toBe(box.height);
      else expect(box.width).toBeGreaterThan(box.height);
    });
  }

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

    await page.goto('/accounts');
    const nav = page.getByRole('navigation', {name: 'Primary'}).first();
    await expect(nav.getByRole('link', {name: 'Transactions, 3 to check'})).toBeVisible();
    await expect.poll(() => reads).toBe(1);
    await page.clock.runFor(4 * 60_000);
    expect(reads).toBe(1);
    await page.clock.runFor(61_000);
    await expect.poll(() => reads).toBe(2);

    await page.goto(`/transactions?transactionId=${transaction.id}`);
    await page.getByRole('combobox', {name: 'Transaction category'}).click();
    await page.getByRole('option', {name: 'Travel', exact: true}).click();
    await expect(page.getByRole('combobox', {name: 'Transaction category'})).toHaveText('Travel');
    await page.keyboard.press('Escape');
    await expect(nav.getByRole('link', {name: 'Transactions, 2 to check'})).toBeVisible();
  });
});

test.describe('the Wisp mark', () => {
  test.use({storageState: {cookies: [], origins: []}, timezoneId: 'Europe/Amsterdam'});

  test('the phone header mark is 28px inside a 44px home link, centred in its 48px row', async ({
    page,
  }) => {
    await page.setViewportSize({width: 390, height: 844});
    await mockSyntheticHome(page);
    await page.goto('/insights');
    const header = await boxOf(page.getByRole('banner'));
    const link = page.getByRole('banner').getByRole('link', {name: 'Wisp home'});
    const target = await boxOf(link);
    const mark = await boxOf(link.locator('svg'));
    expect(target).toMatchObject({width: 44, height: 44});
    expect(mark).toMatchObject({width: 28, height: 28});
    // The header is 48px with its bottom border, the mark in the row's middle.
    expect(header.height).toBe(48);
    expect(Math.abs(mark.y + mark.height / 2 - (header.y + 24))).toBeLessThanOrEqual(1);

    await link.click();
    await expect(page).toHaveURL(/^https?:\/\/[^/]+\/(?:\?|$)/);
  });

  test('the sidebar mark is 28px inside a 36px home link', async ({page}) => {
    await page.setViewportSize({width: 1440, height: 900});
    await mockSyntheticHome(page);
    await page.goto('/insights');
    const link = page.getByTestId('app-sidebar').getByRole('link', {name: 'Wisp home'});
    expect(await boxOf(link)).toMatchObject({width: 36, height: 36});
    expect(await boxOf(link.locator('svg'))).toMatchObject({width: 28, height: 28});

    await link.click();
    await expect(page).toHaveURL(/^https?:\/\/[^/]+\/(?:\?|$)/);
  });

  test('auth pages show the mark at 48px', async ({page}) => {
    await page.setViewportSize({width: 390, height: 844});
    await page.route('**/accounts/me', (route) =>
      fulfillJson(route, {message: 'Unauthorized'}, 401),
    );
    await page.goto('/login');
    const mark = await boxOf(page.getByRole('link', {name: 'Wisp home'}).locator('svg'));
    expect(mark.width).toBe(48);
    expect(mark.height).toBe(48);
  });
});
