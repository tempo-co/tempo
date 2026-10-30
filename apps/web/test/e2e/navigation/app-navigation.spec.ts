import {expect, test} from '@playwright/test';
import {VERIFIED_USER_AUTH_FILE} from 'test/constants/auth.constants';
import {boxOf, expectNoHorizontalOverflow} from 'test/utils/layout';

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
