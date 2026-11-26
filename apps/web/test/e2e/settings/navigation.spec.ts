import type {Locator, Page} from '@playwright/test';

import {createAccount} from '../../data/account.data';
import {expect, test} from '../../fixtures';
import {mockBankConnections, mockBankRefresh, mockEmptyHome} from '../../utils/api-mocks';

// The service worker would serve route code from its cache, past the delays below.
test.use({storageState: {cookies: [], origins: []}, serviceWorkers: 'block'});

test.beforeEach(async ({page}) => {
  await page.route('**/accounts/me', (route) =>
    route.fulfill({
      json: createAccount({
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Alex Example',
        email: 'alex@example.com',
      }),
    }),
  );
  await page.route('**/auth/sessions', (route) => route.fulfill({json: []}));
  await page.route('**/personal-access-tokens', (route) => route.fulfill({json: []}));
});

/** Each section by its address and its name, with something only it shows. */
const SECTIONS = [
  {path: 'profile', label: 'Profile', shows: (page: Page) => page.getByTestId('edit-name-button')},
  {
    path: 'security',
    label: 'Security',
    shows: (page: Page) => page.getByTestId('change-password-button'),
  },
  {
    path: 'notifications',
    label: 'Notifications',
    shows: (page: Page) => page.getByRole('region', {name: 'Alerts', exact: true}),
  },
  {
    path: 'categories',
    label: 'Categories',
    shows: (page: Page) => page.getByRole('list', {name: 'All categories'}),
  },
  {
    path: 'data',
    label: 'Your data',
    shows: (page: Page) => page.getByTestId('delete-account-button'),
  },
  {
    path: 'appearance',
    label: 'Appearance',
    shows: (page: Page) => page.getByRole('radio', {name: 'Dark'}),
  },
  {
    path: 'integrations',
    label: 'Integrations',
    shows: (page: Page) => page.getByRole('heading', {name: 'Access tokens', exact: true}),
  },
] as const;

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

/** The announced sections that have not shipped: listed, marked later, and not links. */
async function expectLaterRows(nav: Locator) {
  for (const label of ['Billing', 'Members']) {
    const row = nav.getByText(label, {exact: true});
    await expect(row).toBeVisible();
    await expect(nav.getByRole('link', {name: new RegExp(label)})).toHaveCount(0);
  }
  await expect(nav.getByText('later', {exact: true})).toHaveCount(2);
  await expect(nav.getByText('Tags')).toHaveCount(0);
}

test.describe('Settings navigation', () => {
  test('on desktop, Settings opens Profile and every section is at its address and in the list', async ({
    page,
  }) => {
    await page.setViewportSize({width: 1440, height: 900});
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/settings\/profile$/);
    await expect(page.getByRole('heading', {level: 1})).toHaveText('Settings');

    const nav = page.getByRole('navigation', {name: 'Settings sections'});
    await expect(nav.getByRole('link')).toHaveText(SECTIONS.map((section) => section.label));
    await expectLaterRows(nav);

    for (const section of SECTIONS) {
      await page.goto(`/settings/${section.path}`);
      await expect.poll(() => currentLabels(nav)).toEqual([section.label]);
      await expect(
        page.getByRole('heading', {level: 2, name: section.label, exact: true}),
      ).toBeVisible();
      await expect(section.shows(page)).toBeVisible();
    }

    for (const section of [...SECTIONS].reverse()) {
      await nav.getByRole('link', {name: section.label, exact: true}).click();
      await expect(page).toHaveURL(new RegExp(`/settings/${section.path}$`));
      await expect(section.shows(page)).toBeVisible();
      expect(await currentLabels(nav)).toEqual([section.label]);
    }

    // Account's earlier address opens Profile.
    await page.goto('/settings/account');
    await expect(page).toHaveURL(/\/settings\/profile$/);
  });

  test('on a phone, Settings is a list to tap into, with a way back', async ({page}) => {
    await page.setViewportSize({width: 390, height: 844});
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole('heading', {level: 1})).toHaveText('Settings');
    const list = page.getByRole('navigation', {name: 'Settings sections'});
    await expect(list.getByRole('link')).toHaveText(
      SECTIONS.map((section) => new RegExp(`^${section.label}`)),
    );
    await expectLaterRows(list);
    for (const link of await list.getByRole('link').all())
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    for (const section of SECTIONS) {
      await list.getByRole('link', {name: new RegExp(`^${section.label}`)}).click();
      await expect(page).toHaveURL(new RegExp(`/settings/${section.path}$`));
      await expect(page.getByRole('heading', {level: 1})).toHaveText(section.label);
      await expect(section.shows(page)).toBeVisible();
      await page.getByRole('main').getByRole('link', {name: 'Settings', exact: true}).click();
      await expect(page).toHaveURL(/\/settings$/);
      await expect(list).toBeVisible();
    }

    // A section's address opens it directly, and back still leads to the list.
    await page.goto('/settings/integrations');
    await expect(page.getByRole('heading', {level: 1})).toHaveText('Integrations');
    await expect(page.getByRole('navigation', {name: 'Settings sections'})).toHaveCount(0);
    await page.getByRole('main').getByRole('link', {name: 'Settings', exact: true}).click();
    await expect(page).toHaveURL(/\/settings$/);
  });

  test('only the section being opened is current while its code loads', async ({page}) => {
    await page.setViewportSize({width: 1440, height: 900});
    await page.goto('/settings/security');
    const nav = page.getByRole('navigation', {name: 'Settings sections'});
    await expect(page.getByTestId('change-password-button')).toBeVisible();

    await delayRouteCode(page);
    await nav.getByRole('link', {name: 'Integrations'}).click();
    await expect(page).toHaveURL(/\/settings\/integrations$/);
    expect(await currentLabels(nav)).toEqual(['Integrations']);
    await expect(page.getByRole('heading', {name: 'Access tokens', exact: true})).toBeVisible();
    expect(await currentLabels(nav)).toEqual(['Integrations']);
  });

  test('moves the phone tab bar marker as soon as another page opens', async ({page}) => {
    await mockEmptyHome(page);
    await mockBankRefresh(page);
    await mockBankConnections(page, []);
    await page.setViewportSize({width: 320, height: 700});
    await page.goto('/settings/security');
    const tabBar = page.getByTestId('app-tab-bar');
    // Settings opens from the header, so no tab marks it.
    await expect(tabBar.locator('a[aria-current="page"]')).toHaveCount(0);

    await delayRouteCode(page);
    await tabBar.getByRole('link', {name: 'Home'}).click();
    await expect(page).toHaveURL(/^https?:\/\/[^/]+\/(?:\?|$)/);
    expect(await currentLabels(tabBar)).toEqual(['Home']);
  });
});
