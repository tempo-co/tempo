import {expect, test} from '@playwright/test';

const account = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Alex Example',
  email: 'alex@example.com',
  isEmailVerified: true,
};

test.use({viewport: {width: 320, height: 850}, storageState: {cookies: [], origins: []}});

test.beforeEach(async ({page}) => {
  await page.route('**/accounts/me', (route) => route.fulfill({json: account}));
});

test('account menu has phone-sized tap targets', async ({page}) => {
  await page.goto('/settings/account');
  await page.getByTestId('account-menu-trigger').click();
  await expect(page.getByRole('menu')).toBeVisible();
  // Measure settled CSS height rather than the dropdown's temporary animation scale.
  const heights = await page
    .getByRole('menuitem')
    .evaluateAll((items) => items.map((item) => parseFloat(getComputedStyle(item).height)));
  expect(heights).toHaveLength(2);
  for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);
});

test('session details wrap long IPv6 and location values on a phone', async ({page}) => {
  await page.route('**/auth/sessions', (route) =>
    route.fulfill({
      json: [
        {
          id: 'example-session',
          name: 'Safari on a phone',
          ip: '2001:db8:1234:5678:1234:5678:1234:5678',
          location: 'An unusually long example city and country',
          deviceType: 'mobile',
          browserType: 'Safari',
          createdAt: '2026-01-01T00:00:00.000Z',
          lastSeenAt: '2026-01-01T00:00:00.000Z',
          isCurrent: true,
        },
      ],
    }),
  );
  await page.goto('/settings/security');
  await page.getByTestId('session-card').locator('button').first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('2001:db8:1234:5678:1234:5678:1234:5678');
  const widths = await dialog.evaluate((element) => ({
    content: element.clientWidth,
    scroll: element.scrollWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.content);
});

test('a pending name save can be closed without cancelling the save', async ({page}) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/accounts/me', async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    await held;
    await route.fulfill({json: {...account, name: 'Another Example'}});
  });
  await page.goto('/settings/account');
  await page.getByTestId('edit-name-button').click();
  await page.getByTestId('name-input').fill('Another Example');
  await page.getByTestId('save-name-button').click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.locator('form').getByRole('button', {name: 'Close', exact: true}),
  ).toBeEnabled();
  await dialog.locator('form').getByRole('button', {name: 'Close', exact: true}).click();
  await expect(dialog).toBeHidden();
  release();
  await expect(page.getByText('Name saved.', {exact: true})).toBeVisible();
  await expect(page.getByTestId('current-account-name')).toHaveText('Another Example');
  await expect(page.getByTestId('edit-name-button')).toBeFocused();
});

test('a successful name save returns keyboard focus to Edit', async ({page}) => {
  await page.route('**/accounts/me', async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    await route.fulfill({json: {...account, name: 'Another Example'}});
  });
  await page.goto('/settings/account');
  await page.getByTestId('edit-name-button').click();
  await page.getByTestId('name-input').fill('Another Example');
  await page.getByTestId('save-name-button').click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByTestId('edit-name-button')).toBeFocused();
});

test('a phone drawer leaves the tab bar and page background in place', async ({page}) => {
  await page.goto('/settings/account');
  const tabBar = page.getByTestId('app-tab-bar');
  const readPlacement = () =>
    tabBar.evaluate((nav) => ({
      bottom: Math.round(nav.getBoundingClientRect().bottom),
      viewport: window.innerHeight,
      background: getComputedStyle(document.body).backgroundColor,
    }));
  const before = await readPlacement();
  expect(before.bottom).toBe(before.viewport);

  await page.getByTestId('edit-name-button').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await readPlacement()).toEqual(before);

  // Read mid-close, while the drawer is still animating out.
  await page.keyboard.press('Escape');
  expect(await readPlacement()).toEqual(before);
  await expect(page.getByRole('dialog')).toBeHidden();
  expect(await readPlacement()).toEqual(before);
});

for (const theme of ['light', 'dark']) {
  test(`destructive confirmations use the destructive label colour (${theme})`, async ({page}) => {
    await page.addInitScript((value) => localStorage.setItem('vite-ui-theme', value), theme);
    const session = {
      name: 'Chrome on a phone',
      ip: '192.0.2.1',
      location: 'Example City',
      deviceType: 'mobile',
      browserType: 'Chrome',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-01T00:00:00.000Z',
    };
    await page.route('**/auth/sessions', (route) =>
      route.fulfill({
        json: [
          {...session, id: 'current-session', isCurrent: true},
          {...session, id: 'other-session', isCurrent: false},
        ],
      }),
    );
    await page.goto('/settings/security');
    await page.getByTestId('revoke-all-sessions-button').click();
    const confirm = page.getByTestId('revoke-all-sessions-button-confirm');
    await expect(confirm).toBeVisible();
    const colours = await confirm.evaluate((button) => {
      const probe = document.createElement('span');
      probe.className = 'text-destructive-foreground';
      document.body.append(probe);
      const expected = getComputedStyle(probe).color;
      probe.remove();
      return {actual: getComputedStyle(button).color, expected};
    });
    expect(colours.actual).toBe(colours.expected);
    expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(
      theme === 'dark',
    );
  });
}
