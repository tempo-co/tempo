import type {Page} from '@playwright/test';

import {mockSyntheticHome} from '../../data/home-history.data';
import {expect, test} from '../../fixtures';
import {boxOf} from '../../utils/layout';

// Headless Chromium hides scrollbars; desktop Chrome on Linux and Windows takes room for them.
test.use({
  storageState: {cookies: [], origins: []},
  timezoneId: 'Europe/Amsterdam',
  launchOptions: {ignoreDefaultArgs: ['--hide-scrollbars']},
});
test.skip(({browserName}) => browserName !== 'chromium', 'Only Chromium shows the scrollbar');

const scrolls = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight);

// CSS locators: an open menu or dialog hides the page from the accessibility tree.
const column = async (page: Page) => {
  const header = await boxOf(page.locator('header a[href="/"]').first());
  // The column holding the page's heading, not the loading bar that lingers beside it after a load.
  const content = await boxOf(page.locator('main > div').filter({has: page.locator('h1, h2')}));
  return {headerX: header.x, contentX: content.x, contentWidth: content.width};
};

for (const width of [1440, 1280]) {
  test(`keeps the header and content in place across long and short pages at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({width, height: 800});
    await mockSyntheticHome(page);

    // Home is longer than the window; Connections, with one bank, is not.
    await page.goto('/');
    await expect(page.getByText('Total balance')).toBeVisible();
    expect(await scrolls(page)).toBe(true);
    const home = await column(page);

    // A menu locks scrolling while open; the page behind it stays put.
    await page.getByTestId('account-menu-trigger').click();
    await expect(page.getByRole('menu')).toBeVisible();
    expect(await column(page)).toEqual(home);
    await page.keyboard.press('Escape');

    await page
      .getByRole('navigation', {name: 'Primary'})
      .getByRole('link', {name: 'Connections'})
      .click();
    await expect(page.getByRole('heading', {name: 'Bank connections'})).toBeVisible();
    expect(await scrolls(page)).toBe(false);
    expect(await column(page)).toEqual(home);

    await page
      .getByRole('button', {name: /details$/})
      .first()
      .click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await column(page)).toEqual(home);

    // Settings narrows its own content, inside the same column.
    await page.goto('/settings/account');
    await expect(page.getByRole('heading', {name: 'Settings'})).toBeVisible();
    expect(await column(page)).toEqual(home);
  });
}
