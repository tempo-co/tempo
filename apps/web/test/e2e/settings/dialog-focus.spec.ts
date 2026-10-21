import {expect, test} from '@playwright/test';

const account = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Alex Example',
  email: 'alex@example.com',
  isEmailVerified: true,
};

const session = (id: string, isCurrent: boolean) => ({
  id,
  name: isCurrent ? 'Safari on a phone' : 'Firefox on a laptop',
  ip: '192.0.2.1',
  location: 'Example City',
  deviceType: isCurrent ? 'mobile' : 'desktop',
  browserType: isCurrent ? 'Safari' : 'Firefox',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
  isCurrent,
});

// Phone width, so every settings dialog renders as a drawer above the tab bar.
test.use({viewport: {width: 390, height: 850}, storageState: {cookies: [], origins: []}});

test.beforeEach(async ({page}) => {
  await page.route('**/accounts/me', (route) => route.fulfill({json: account}));
  await page.route('**/auth/sessions', (route) =>
    route.fulfill({json: [session('current', true), session('other', false)]}),
  );
});

const drawers = [
  {path: '/settings/account', trigger: 'edit-name-button'},
  {path: '/settings/account', trigger: 'change-email-button'},
  {path: '/settings/account', trigger: 'delete-account-button'},
  {path: '/settings/security', trigger: 'change-password-button'},
  {path: '/settings/security', trigger: 'revoke-all-sessions-button'},
  {path: '/settings/security', trigger: 'revoke-session-button'},
  {path: '/settings/security', trigger: 'log-out-button-session'},
];

for (const {path, trigger: testId} of drawers) {
  for (const dismissal of ['Escape', 'Cancel'] as const) {
    test(`${testId} drawer closes on ${dismissal}, keeping the tab bar and page in place, and refocuses its trigger`, async ({
      page,
    }) => {
      await page.goto(path);
      const tabBar = page.getByTestId('app-tab-bar');
      const readPlacement = () =>
        tabBar.evaluate((nav) => ({
          bottom: Math.round(nav.getBoundingClientRect().bottom),
          viewport: window.innerHeight,
          background: getComputedStyle(document.body).backgroundColor,
        }));
      const before = await readPlacement();
      expect(before.bottom).toBe(before.viewport);

      const trigger = page.getByTestId(testId);
      await trigger.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      expect(await readPlacement()).toEqual(before);

      if (dismissal === 'Escape') await page.keyboard.press('Escape');
      else await dialog.getByRole('button', {name: 'Cancel', exact: true}).click();
      // Read mid-close, while the drawer is still animating out.
      expect(await readPlacement()).toEqual(before);

      await expect(dialog).toBeHidden();
      expect(await readPlacement()).toEqual(before);
      await expect(trigger).toBeFocused();
    });
  }
}
