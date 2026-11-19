import {createAccount} from '../../data/account.data';
import {expect, test} from '../../fixtures';
import {countAfterToasts} from '../../utils/toasts';

const account = createAccount({
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Alex Example',
  email: 'alex@example.com',
});

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

test.use({storageState: {cookies: [], origins: []}});

test.beforeEach(async ({page}) => {
  await page.route('**/accounts/me', (route) => route.fulfill({json: account}));
  await page.route('**/auth/sessions', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({json: [session('current', true), session('other', false)]})
      : route.fulfill({status: 500, json: {message: 'Synthetic failure'}}),
  );
});

test('a failed session revocation is reported once in its open confirmation', async ({page}) => {
  await page.route('**/auth/sessions/other', (route) =>
    route.fulfill({status: 500, json: {message: 'Synthetic failure'}}),
  );
  await page.goto('/settings/security');
  await page.getByTestId('revoke-session-button').click();
  const dialog = page.getByRole('dialog');
  await page.getByTestId('revoke-session-button-confirm').click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'The session could not be revoked. Try again.',
  );
  expect(await countAfterToasts(page, page.getByText(/could not be revoked/))).toBe(1);
  await expect(page.getByTestId('revoke-session-button-confirm')).toBeEnabled();
});

test('a revocation of all other sessions that fails after its confirmation closed toasts once', async ({
  page,
}) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/auth/sessions', async (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    await held;
    await route.fallback();
  });
  await page.goto('/settings/security');
  await page.getByTestId('revoke-all-sessions-button').click();
  const dialog = page.getByRole('dialog');
  await page.getByTestId('revoke-all-sessions-button-confirm').click();
  try {
    await dialog.getByRole('button', {name: 'Cancel', exact: true}).click();
    await expect(dialog).toBeHidden();
  } finally {
    release();
  }
  await expect(page.locator('[data-sonner-toast]')).toHaveText(
    'Other sessions could not be revoked. Try again.',
  );
  expect(await countAfterToasts(page, page.getByText(/could not be revoked/))).toBe(1);
});
