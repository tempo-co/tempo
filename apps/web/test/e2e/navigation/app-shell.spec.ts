import type {Page} from '@playwright/test';

import {HOME_REVIEW_COUNTS, mockSyntheticHome} from '../../data/home-history.data';
import {expect, test} from '../../fixtures';
import {mockEmptyRecurringLists, mockJson} from '../../utils/api-mocks';
import {boxOf, expectNoHorizontalOverflow} from '../../utils/layout';

test.use({storageState: {cookies: [], origins: []}, timezoneId: 'Europe/Amsterdam'});

/** Every page the shell reaches answers from mocks, so nothing reaches a shared API. */
async function mockPages(page: Page) {
  await mockSyntheticHome(page, {reviewCounts: {...HOME_REVIEW_COUNTS, needsAttention: 3}});
  await mockEmptyRecurringLists(page);
  await mockJson(page, '**/bank-connections/aspsps', []);
  await mockJson(page, '**/notifications', {publicKey: null, preferences: {bankConnections: true}});
}

const HOME = /^https?:\/\/[^/]+\/(?:\?|$)/;
const desktopPages = [
  {label: 'Transactions', url: /\/transactions(?:\?|$)/, heading: 'Transactions'},
  {label: 'Insights', url: /\/insights(?:\?|$)/, heading: 'Insights'},
  {label: 'Recurring', url: /\/recurring(?:\?|$)/, heading: 'Recurring'},
  {label: 'Accounts', url: /\/accounts(?:\?|$)/, heading: 'Accounts'},
  {label: 'Home', url: HOME, heading: null},
];

test('the desktop sidebar reaches every page, collapses for good and opens Settings', async ({
  page,
}) => {
  await page.setViewportSize({width: 1440, height: 900});
  await mockPages(page);
  await page.goto('/');

  const sidebar = page.getByTestId('app-sidebar');
  const nav = sidebar.getByRole('navigation', {name: 'Primary'});
  await expect(page.getByTestId('app-tab-bar')).toBeHidden();
  await expect(sidebar.getByRole('button', {name: 'Add data'})).toBeVisible();
  // Plan is shown for later, not reachable.
  await expect(sidebar.getByText('Plan')).toBeVisible();
  await expect(sidebar.getByText('later')).toBeVisible();
  await expect(sidebar.getByRole('link', {name: /Plan/})).toHaveCount(0);
  await expect(sidebar.getByText('Example Owner')).toBeVisible();
  await expect(sidebar.getByText('owner@example.com')).toBeVisible();
  await expect(sidebar.getByRole('link', {name: 'Transactions, 3 to check'})).toBeVisible();

  for (const {label, url, heading} of desktopPages) {
    const link = nav.getByRole('link', {name: new RegExp(`^${label}`)});
    await link.click();
    await expect(page).toHaveURL(url);
    await expect(link).toHaveAttribute('aria-current', 'page');
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    if (heading) await expect(page.getByRole('heading', {level: 1})).toHaveText(heading);
  }

  // Collapsed, the sidebar keeps its icons and their names, and this device remembers it.
  const wide = (await boxOf(page.getByTestId('app-sidebar'))).width;
  await sidebar.getByRole('button', {name: 'Collapse sidebar'}).click();
  await expect(sidebar.getByRole('button', {name: 'Expand sidebar'})).toBeVisible();
  await expect(sidebar.getByText('owner@example.com')).toBeHidden();
  await expect
    .poll(async () => (await boxOf(page.getByTestId('app-sidebar'))).width)
    .toBeLessThan(wide / 3);
  await page.reload();
  await expect(sidebar.getByRole('button', {name: 'Expand sidebar'})).toBeVisible();
  await expect(nav.getByRole('link', {name: 'Home'})).toHaveAttribute('aria-current', 'page');
  await nav.getByRole('link', {name: 'Insights'}).click();
  await expect(page).toHaveURL(/\/insights(?:\?|$)/);

  await sidebar.getByRole('link', {name: 'Settings'}).click();
  await expect(page).toHaveURL(/\/settings\/profile$/);
  await expect(page.getByRole('heading', {level: 1})).toHaveText('Settings');
  await expect(nav.locator('[aria-current="page"]')).toHaveCount(0);

  await sidebar.getByRole('button', {name: 'Expand sidebar'}).click();
  await page.reload();
  await expect(sidebar.getByRole('button', {name: 'Collapse sidebar'})).toBeVisible();
});

test('the phone tabs reach every page, with Settings and Add data in the header', async ({
  page,
}) => {
  await page.setViewportSize({width: 390, height: 844});
  await mockPages(page);
  await page.goto('/');

  const tabBar = page.getByTestId('app-tab-bar');
  await expect(page.getByTestId('app-sidebar')).toBeHidden();
  // A screen reader hears each tab's label, Transactions with its To check count; the count badge itself is hidden.
  const tabs = tabBar.getByRole('link');
  await expect(tabs).toHaveCount(4);
  for (const [index, name] of [
    'Home',
    'Transactions, 3 to check',
    'Insights',
    'Accounts',
  ].entries())
    await expect(tabs.nth(index)).toHaveAccessibleName(name);

  for (const {label, url} of [
    {label: 'Transactions', url: /\/transactions(?:\?|$)/},
    {label: 'Insights', url: /\/insights(?:\?|$)/},
    {label: 'Accounts', url: /\/accounts(?:\?|$)/},
    {label: 'Home', url: HOME},
  ]) {
    const tab = tabBar.getByRole('link', {name: new RegExp(`^${label}`)});
    await tab.click();
    await expect(page).toHaveURL(url);
    await expect(tab).toHaveAttribute('aria-current', 'page');
    expect((await boxOf(tab)).height).toBeGreaterThanOrEqual(44);
  }

  const header = page.getByTestId('app-phone-header');
  // With file import off, Add data opens on its one way in, over the page.
  await header.getByRole('button', {name: 'Add data'}).click();
  const sheet = page.getByTestId('add-data-sheet');
  await expect(sheet.getByRole('heading', {name: 'Connect a bank'})).toBeVisible();
  await expect(page).toHaveURL(HOME);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await header.getByRole('link', {name: 'Settings'}).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(tabBar.locator('[aria-current="page"]')).toHaveCount(0);

  // The page reserves room for the fixed tab bar, so the last content is never hidden behind it.
  const mainPadding = await page
    .locator('main')
    .evaluate((main) => parseFloat(getComputedStyle(main).paddingBottom));
  expect(mainPadding).toBeGreaterThanOrEqual((await boxOf(tabBar)).height);
  await expectNoHorizontalOverflow(page);
});

test('old Connections, Transactions, merchants and recurring links open the pages that hold them', async ({
  page,
}) => {
  await page.setViewportSize({width: 1440, height: 900});
  await mockPages(page);

  await page.goto('/bank-connections?result=cancelled');
  await expect(page).toHaveURL(/\/accounts(?:\?|$)/);
  await expect(
    page
      .getByTestId('add-data-sheet')
      .getByRole('heading', {name: "You didn't finish at your bank"}),
  ).toBeVisible();
  await page.keyboard.press('Escape');

  await page.goto('/bank-transactions?search=Example%20Market');
  await expect(page).toHaveURL(/\/transactions\?search=Example(?:\+|%20)Market$/);
  await expect(page.getByTestId('bank-transactions-search')).toHaveValue('Example Market');

  // A merchant or series link over any page opens Insights or Recurring with it.
  await page.goto('/transactions?merchants=open');
  await expect(page).toHaveURL(/\/insights$/);
  await expect(page.getByRole('heading', {name: 'Insights', level: 1})).toBeVisible();
  const series = 'a'.repeat(32);
  await page.goto(`/?recurring=open&series=${series}`);
  await expect(page).toHaveURL(`/recurring?series=${series}`);
});
