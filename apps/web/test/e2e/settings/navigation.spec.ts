import {boxOf, expectNoHorizontalOverflow} from 'test/utils/layout';

import {expect, test} from '../../fixtures';

test.use({storageState: {cookies: [], origins: []}});

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

  test('fits the section tabs on a narrow phone, aligned with the title', async ({page}) => {
    await page.setViewportSize({width: 320, height: 700});
    await page.goto('/settings/security');

    const sections = page.getByRole('navigation', {name: 'Settings sections'});
    const [title, nav, firstLabel, lastTab] = await Promise.all([
      boxOf(page.getByRole('heading', {level: 1})),
      boxOf(sections),
      sections.getByRole('link', {name: 'Account'}).evaluate((link) => {
        const range = document.createRange();
        range.selectNodeContents(link);
        return range.getBoundingClientRect().x;
      }),
      boxOf(sections.getByRole('link', {name: 'Appearance'})),
    ]);
    expect(lastTab.x + lastTab.width).toBeLessThanOrEqual(nav.x + nav.width);
    expect(Math.abs(firstLabel - title.x)).toBeLessThan(1);
    await expectNoHorizontalOverflow(page);

    await sections.getByRole('link', {name: 'Integrations'}).click();
    await expect(page).toHaveURL(/\/settings\/integrations$/);
    await expect(sections.locator('a[aria-current="page"]')).toHaveText('Integrations');
  });
});
