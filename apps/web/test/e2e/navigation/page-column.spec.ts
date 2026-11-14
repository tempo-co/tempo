import type {Page} from '@playwright/test';

import {mockSyntheticHome} from '../../data/home-history.data';
import {expect, test} from '../../fixtures';
import {mockJson} from '../../utils/api-mocks';
import {boxOf, expectLoaded} from '../../utils/layout';

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
  return {headerX: header.x, contentX: content.x, contentWidth: content.width, top: content.y};
};

/** Where the page title starts, and where the content below its row starts. */
const title = (page: Page) =>
  page.locator('main h1').evaluate((heading) => ({
    x: heading.getBoundingClientRect().x,
    y: heading.getBoundingClientRect().y,
    // Settings' title shares its block with the tabs, so it has no row of its own.
    contentY: heading.parentElement!.nextElementSibling?.getBoundingClientRect().y ?? null,
  }));

const mockPages = async (page: Page) => {
  await mockSyntheticHome(page);
  // Connections and Settings ask for more than Home; in CI an unmocked request reaches the API and signs out.
  await mockJson(page, '**/bank-connections/aspsps', []);
  await mockJson(page, '**/notifications', {
    publicKey: null,
    preferences: {bankConnections: true},
  });
};

for (const width of [1440, 1280]) {
  test(`keeps the header and content in place across long and short pages at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({width, height: 800});
    await mockPages(page);

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
    await expect(page.getByRole('heading', {name: 'Bank connections', exact: true})).toBeVisible();
    expect(await scrolls(page)).toBe(false);
    expect(await column(page)).toEqual(home);
    // Home has no title, so its content starts where the title does; the Connect button overhangs the title's row.
    const connections = await title(page);
    expect(connections).toMatchObject({x: home.contentX + 16, y: home.top});

    await page
      .getByRole('button', {name: /details$/})
      .first()
      .click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await column(page)).toEqual(home);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();

    await page
      .getByRole('navigation', {name: 'Primary'})
      .getByRole('link', {name: /^Transactions/})
      .click();
    await expect(page.getByRole('heading', {name: 'Bank transactions', exact: true})).toBeVisible();
    await expectLoaded(page);
    expect(await column(page)).toEqual(home);
    expect(await title(page)).toEqual(connections);

    // Settings narrows its own content, inside the same column.
    await page.goto('/settings/account');
    await expect(page.getByRole('heading', {name: 'Settings', exact: true})).toBeVisible();
    expect(await column(page)).toEqual(home);
    expect((await title(page)).y).toBe(home.top);
  });
}

// At 390px the Connect button wraps under its title; at 430px it sits beside it.
for (const [width, wraps] of [
  [390, true],
  [430, false],
] as const) {
  test(`starts every page title where Home starts its content on a ${width}px phone`, async ({
    page,
  }) => {
    await page.setViewportSize({width, height: 844});
    await mockPages(page);
    await page.goto('/');
    await expect(page.getByText('Total balance')).toBeVisible();
    const home = await column(page);
    for (const [path, name] of [
      ['/bank-connections', 'Bank connections'],
      ['/bank-transactions', 'Bank transactions'],
      ['/settings/account', 'Settings'],
    ]) {
      await page.goto(path);
      await expect(page.getByRole('heading', {name, exact: true})).toBeVisible();
      expect(await title(page), path).toMatchObject({x: 16, y: home.top});
    }
    // Wrapped, the Connect button keeps 12px under the title; beside it, it centres on the title's row.
    // Either way the cards start 16px below it.
    await page.goto('/bank-connections');
    await expect(page.getByRole('heading', {name: 'Bank connections', exact: true})).toBeVisible();
    const [heading, button] = await Promise.all([
      boxOf(page.getByRole('heading', {name: 'Bank connections', exact: true})),
      boxOf(page.getByTestId('connect-bank-button')),
    ]);
    if (wraps) expect(button.y - (heading.y + heading.height)).toBe(12);
    else expect(button.y + button.height / 2).toBe(heading.y + heading.height / 2);
    expect((await title(page)).contentY! - (button.y + button.height)).toBe(16);
  });
}
