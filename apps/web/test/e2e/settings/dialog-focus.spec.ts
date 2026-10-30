import {expect, test} from '../../fixtures';

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

for (const {path, trigger: testId} of drawers) {
  test(`${testId} can be scrolled and cancelled in a short phone viewport`, async ({page}) => {
    await page.setViewportSize({width: 568, height: 320});
    await page.goto(path);
    const trigger = page.getByTestId(testId);
    await trigger.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished));
    });
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(320);
    await dialog.hover();
    await page.mouse.wheel(0, 1000);
    const cancel = dialog.getByRole('button', {name: 'Cancel', exact: true});
    await expect(cancel).toBeInViewport({ratio: 1});
    await cancel.click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
}

for (const width of [390, 1024]) {
  test(`settings dialogs respect reduced motion at ${width}px`, async ({page}) => {
    await page.emulateMedia({reducedMotion: 'reduce'});
    await page.setViewportSize({width, height: 850});
    await page.goto('/settings/account');
    const trigger = page.getByTestId('edit-name-button');
    await trigger.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const motion = await dialog.evaluate((element) => ({
      animation: getComputedStyle(element).animationName,
      transition: getComputedStyle(element).transitionDuration,
    }));
    expect(motion.animation).toBe('none');
    expect(motion.transition.split(',').every((duration) => parseFloat(duration) === 0)).toBe(true);
    await dialog.getByRole('button', {name: 'Cancel', exact: true}).click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
}
