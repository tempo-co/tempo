import type {Locator, Page} from '@playwright/test';

import {expect, test} from '../../fixtures';
import {mockBankConnections, mockBankRefresh, mockEmptyHome} from '../../utils/api-mocks';
import {boxOf, expectNoHorizontalOverflow} from '../../utils/layout';

// The service worker would serve route code from its cache, past the delays below.
test.use({storageState: {cookies: [], origins: []}, serviceWorkers: 'block'});

test.beforeEach(async ({page}) => {
  await page.route('**/accounts/me', (route) =>
    route.fulfill({
      json: {
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Alex Example',
        email: 'alex@example.com',
        isEmailVerified: true,
      },
    }),
  );
  await page.route('**/auth/sessions', (route) => route.fulfill({json: []}));
  await page.route('**/personal-access-tokens', (route) => route.fulfill({json: []}));
});

/** Holds back lazily loaded route code, keeping the next navigation pending for a moment. */
async function delayRouteCode(page: Page) {
  await page.route(/\/assets\/.+\.js$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 750));
    await route.continue();
  });
}

/** Labels of the links currently marked as the open page, read in one pass. */
function currentLabels(nav: Locator) {
  return nav
    .locator('a[aria-current="page"]')
    .evaluateAll((links) => links.map((link) => link.textContent?.trim()));
}

test.describe('Settings navigation', () => {
  test('keeps the section navigation aligned with the active page', async ({page}) => {
    const routes = [
      {path: 'account', label: 'Account'},
      {path: 'security', label: 'Security'},
      {path: 'integrations', label: 'Integrations'},
      {path: 'appearance', label: 'Appearance'},
    ];

    for (const route of routes) {
      await page.goto(`/settings/${route.path}`);
      await expect(page.getByRole('heading', {level: 1})).toHaveText('Settings');

      const sections = page.getByRole('navigation', {name: 'Settings sections'});
      await expect(sections).toHaveCount(1);
      await expect(sections.getByRole('link')).toHaveText(routes.map((route) => route.label));
      const active = sections.locator('a[aria-current="page"]');
      await expect(active).toHaveCount(1);
      await expect(active).toHaveText(route.label);
      await expect(active).toHaveAttribute('href', `/settings/${route.path}`);
    }
  });

  for (const {width, fontSize} of [
    {width: 320, fontSize: 13},
    {width: 359, fontSize: 13},
    {width: 390, fontSize: 14},
  ]) {
    test(`spreads the section tabs across a ${width}px phone`, async ({page}) => {
      await page.setViewportSize({width, height: 700});
      await page.goto('/settings/security');

      const sections = page.getByRole('navigation', {name: 'Settings sections'});
      const tabs = sections.getByRole('link');
      const nav = await boxOf(sections);
      const boxes = await Promise.all((await tabs.all()).map(boxOf));
      expect(Math.abs(boxes[0].x - nav.x)).toBeLessThan(1);
      const last = boxes[boxes.length - 1];
      expect(Math.abs(last.x + last.width - (nav.x + nav.width))).toBeLessThan(1);
      for (const box of boxes) expect(box.height).toBeGreaterThanOrEqual(48);
      const labels = await tabs.evaluateAll((links) =>
        links.map((link) => {
          const range = document.createRange();
          range.selectNodeContents(link);
          const text = range.getBoundingClientRect();
          const box = link.getBoundingClientRect();
          return {
            fontSize: parseFloat(getComputedStyle(link).fontSize),
            inside: text.left >= box.left && text.right <= box.right,
            centreOffset: text.left + text.width / 2 - (box.left + box.width / 2),
          };
        }),
      );
      for (const label of labels) {
        expect(label.fontSize).toBe(fontSize);
        expect(label.inside).toBe(true);
        expect(Math.abs(label.centreOffset)).toBeLessThan(1);
      }
      const underline = await sections
        .locator('a[aria-current="page"]')
        .evaluate((link) => [
          parseFloat(getComputedStyle(link, '::after').width),
          link.getBoundingClientRect().width,
        ]);
      expect(Math.abs(underline[0] - underline[1])).toBeLessThan(1);
      await expectNoHorizontalOverflow(page);

      // While the next section's code loads, only the tab being opened is current.
      await delayRouteCode(page);
      await tabs.filter({hasText: 'Integrations'}).click();
      await expect(page).toHaveURL(/\/settings\/integrations$/);
      expect(await currentLabels(sections)).toEqual(['Integrations']);
      await expect(page.getByRole('heading', {name: 'Access tokens', exact: true})).toBeVisible();
      expect(await currentLabels(sections)).toEqual(['Integrations']);
    });
  }

  test('moves the phone tab bar marker as soon as another page opens', async ({page}) => {
    await mockEmptyHome(page);
    await mockBankRefresh(page);
    await mockBankConnections(page, []);
    await page.setViewportSize({width: 320, height: 700});
    await page.goto('/settings/security');
    const tabBar = page.getByTestId('app-tab-bar');
    await expect(tabBar.locator('a[aria-current="page"]')).toHaveText('Settings');

    await delayRouteCode(page);
    await tabBar.getByRole('link', {name: 'Home'}).click();
    await expect(page).toHaveURL(/^https?:\/\/[^/]+\/(?:\?|$)/);
    expect(await currentLabels(tabBar)).toEqual(['Home']);
  });

  test('aligns the first section label with the title on desktop', async ({page}) => {
    await page.setViewportSize({width: 1440, height: 900});
    await page.goto('/settings/security');

    const sections = page.getByRole('navigation', {name: 'Settings sections'});
    const [title, firstLabel] = await Promise.all([
      boxOf(page.getByRole('heading', {level: 1})),
      sections.getByRole('link', {name: 'Account'}).evaluate((link) => {
        const range = document.createRange();
        range.selectNodeContents(link);
        return range.getBoundingClientRect().x;
      }),
    ]);
    expect(Math.abs(firstLabel - title.x)).toBeLessThan(1);
  });
});
