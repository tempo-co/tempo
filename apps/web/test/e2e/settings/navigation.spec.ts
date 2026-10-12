import {expect, test} from '@playwright/test';
import {VERIFIED_USER_AUTH_FILE} from 'test/constants/auth.constants';
import {boxOf, expectNoHorizontalOverflow} from 'test/utils/layout';

test.use({storageState: VERIFIED_USER_AUTH_FILE});

test.describe('Settings navigation', () => {
  test('keeps the section navigation aligned with the active page', async ({page}) => {
    const routes = [
      {path: 'account', label: 'Account'},
      {path: 'security', label: 'Security'},
      {path: 'appearance', label: 'Appearance'},
    ];

    for (const route of routes) {
      await page.goto(`/settings/${route.path}`);
      await expect(page.getByRole('heading', {level: 1})).toHaveText('Settings');

      const sections = page.getByRole('navigation', {name: 'Settings sections'});
      await expect(sections).toHaveCount(1);
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

    await sections.getByRole('link', {name: 'Appearance'}).click();
    await expect(page).toHaveURL(/\/settings\/appearance$/);
    await expect(sections.locator('a[aria-current="page"]')).toHaveText('Appearance');
  });
});
