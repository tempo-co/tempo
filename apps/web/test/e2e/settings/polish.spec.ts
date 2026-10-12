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
