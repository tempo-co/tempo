import {expect, test} from '@playwright/test';

import {VERIFIED_USER_AUTH_FILE} from 'test/constants/auth.constants';

test.use({storageState: VERIFIED_USER_AUTH_FILE});

test('closes the mobile sidebar after selecting a navigation item', async ({page}) => {
  await page.setViewportSize({width: 393, height: 852});
  await page.goto('/');

  await page.getByRole('button', {name: 'Toggle Sidebar'}).click();

  const mobileSidebar = page.locator('[data-sidebar="sidebar"][data-mobile="true"]');
  await expect(mobileSidebar).toBeVisible();

  await mobileSidebar.getByRole('link', {name: 'Bank connections'}).click();

  await expect(page).toHaveURL(/\/bank-connections$/);
  await expect(mobileSidebar).toBeHidden();
});