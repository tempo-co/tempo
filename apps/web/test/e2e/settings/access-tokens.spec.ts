import {expect, test} from '../../fixtures';
import {createHookHarness} from '../../utils/hook-harness';
import {expectNoHorizontalOverflow} from '../../utils/layout';

const account = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Alex Example',
  email: 'alex@example.com',
  isEmailVerified: true,
};
const tokenMetadata = {
  id: '00000000-0000-4000-8000-000000000002',
  name: 'Example integration',
  prefix: 'tempo_pat_example',
  scopes: ['read'],
  createdAt: '2026-01-02T12:00:00.000Z',
  lastUsedAt: null,
  expiresAt: '2027-01-02T12:00:00.000Z',
};
const secret = 'tempo_pat_example_synthetic_secret_not_a_real_token';

test('delivers the created secret only to the dialog, keeping query and mutation caches secret-free', async () => {
  const {client, renderHook} = createHookHarness({
    '@/utils/api': {api: {post: () => Promise.resolve({...tokenMetadata, token: secret})}},
    sonner: {toast: {}},
  });
  let shown: string | undefined;
  client.setQueryData(['personal-access-tokens'], []);
  try {
    const create = renderHook<{mutateAsync: (dto: {name: string}) => Promise<void>}>(
      'src/features/settings/api/use-personal-access-tokens.ts',
      'useCreatePersonalAccessToken',
      (value: string) => {
        shown = value;
      },
    );
    await create.mutateAsync({name: tokenMetadata.name});
    expect(shown).toBe(secret);
    expect(client.getQueryState(['personal-access-tokens'])?.isInvalidated).toBe(true);
    expect(
      JSON.stringify(
        client
          .getQueryCache()
          .getAll()
          .map((query) => query.state),
      ),
    ).not.toContain(secret);
    expect(
      JSON.stringify(
        client
          .getMutationCache()
          .getAll()
          .map((mutation) => mutation.state),
      ),
    ).not.toContain(secret);
  } finally {
    client.clear();
  }
});

test.use({storageState: {cookies: [], origins: []}});

test.beforeEach(async ({page}) => {
  await page.route('**/accounts/me', (route) => route.fulfill({json: account}));
});

for (const width of [1440, 320]) {
  test(`creates, copies and dismisses a one-time token, then revokes its access (${width}px)`, async ({
    page,
  }) => {
    // The whole create, copy, revoke journey, including the 2 s copy confirmation.
    test.setTimeout(20_000);
    await page.setViewportSize({width, height: 900});
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    let tokens: (typeof tokenMetadata)[] = [];
    let creates = 0;
    let revokes = 0;
    await page.route('**/personal-access-tokens', async (route) => {
      if (route.request().isNavigationRequest()) return route.fallback();
      if (route.request().method() === 'POST') {
        creates++;
        expect(route.request().postDataJSON()).toEqual({
          name: tokenMetadata.name,
          expiresInDays: 365,
        });
        tokens = [tokenMetadata];
        return route.fulfill({status: 201, json: {...tokenMetadata, token: secret}});
      }
      return route.fulfill({json: tokens});
    });
    await page.route('**/personal-access-tokens/*', async (route) => {
      expect(route.request().method()).toBe('DELETE');
      expect(route.request().url()).toContain(tokenMetadata.id);
      revokes++;
      tokens = [];
      await route.fulfill({status: 204});
    });
    await page.goto('/settings/integrations');
    await expect(page.getByText('No access tokens yet.', {exact: true})).toBeVisible();
    // Empty: the empty state owns the only create action.
    await expect(page.getByRole('button', {name: 'Create token', exact: true})).toHaveCount(1);
    await page.getByRole('button', {name: 'Create token', exact: true}).click();
    const dialog = page.getByRole('dialog');
    const expectPhoneActions = async () => {
      if (width >= 768) return;
      const heights = await dialog
        .getByRole('button')
        .evaluateAll((buttons) =>
          buttons.map((button) => parseFloat(getComputedStyle(button).height)),
        );
      for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);
    };
    await expectPhoneActions();
    await dialog.getByLabel('Name', {exact: true}).fill(`  ${tokenMetadata.name}  `);
    // Tokens default to 90 days; the creator can pick another lifetime.
    const expiration = dialog.getByRole('combobox', {name: 'Expiration'});
    await expect(expiration).toHaveText('90 days');
    await expiration.click();
    await expect(page.getByRole('option')).toHaveText([
      '30 days',
      '90 days',
      '1 year',
      'No expiration',
    ]);
    await page.getByRole('option', {name: '1 year', exact: true}).click();
    await dialog.getByRole('button', {name: 'Create token', exact: true}).click();
    await expect(dialog.getByLabel('Access token', {exact: true})).toHaveValue(secret);
    await expectPhoneActions();
    await expect(dialog).toContainText("You won't be able to see it again.");
    const field = dialog.getByLabel('Access token', {exact: true});
    const copyButton = dialog.getByRole('button', {name: 'Copy token', exact: true});
    // One line, monospace, with copy inside the field's right edge; Done is the footer's only action.
    expect(await field.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/mono/i);
    const [fieldBox, copyBox] = await Promise.all([field.boundingBox(), copyButton.boundingBox()]);
    expect(fieldBox!.height).toBeLessThanOrEqual(48);
    expect(copyBox!.x).toBeGreaterThan(fieldBox!.x + fieldBox!.width - 1);
    expect(copyBox!.y).toBeGreaterThanOrEqual(fieldBox!.y - 1);
    expect(copyBox!.y + copyBox!.height).toBeLessThanOrEqual(fieldBox!.y + fieldBox!.height + 1);
    // Focusing the field selects the whole token for keyboard copy.
    await field.focus();
    expect(
      await field.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd]),
    ).toEqual([0, secret.length]);
    // Neither selecting the token nor clicking copy draws a ring around the field.
    const fieldFrame = field.locator('xpath=..');
    const ringless = async () =>
      expect(await fieldFrame.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('none');
    await ringless();
    await copyButton.click();
    await ringless();
    await expect(dialog.getByRole('button', {name: 'Copied', exact: true})).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(secret);
    // The confirmation is brief, so the action is ready again for another copy.
    await expect(dialog.getByRole('button', {name: 'Copy token', exact: true})).toBeVisible({
      timeout: 4000,
    });
    const storage = await page.evaluate(() => ({
      local: {...localStorage},
      session: {...sessionStorage},
      url: location.href,
    }));
    expect(JSON.stringify(storage)).not.toContain(secret);
    await expectNoHorizontalOverflow(page);
    await dialog.getByRole('button', {name: 'Done', exact: true}).click();
    await expect(dialog).toBeHidden();
    const row = page.getByTestId('access-token-row');
    await expect(row).toContainText(tokenMetadata.name);
    await expect(row).toContainText(tokenMetadata.prefix);
    await expect(row.getByTestId('access-token-usage')).toHaveText(
      /^Created 2 Jan 2026·?Never used$/,
    );
    await expect(row.getByTestId('access-token-expiry')).toHaveText('Expires 2 Jan 2027');
    // Wide screens keep the timeline on one line; phones stack each part.
    const [usageBox, expiryBox] = await Promise.all([
      row.getByTestId('access-token-usage').boundingBox(),
      row.getByTestId('access-token-expiry').boundingBox(),
    ]);
    if (width >= 768) expect(Math.abs(expiryBox!.y - usageBox!.y)).toBeLessThan(2);
    else expect(expiryBox!.y).toBeGreaterThan(usageBox!.y + usageBox!.height - 1);
    // With tokens listed, creation moves to the section header, above the list.
    const headerCreate = page.getByRole('button', {name: 'Create token', exact: true});
    await expect(headerCreate).toHaveCount(1);
    expect((await headerCreate.boundingBox())!.y).toBeLessThan((await row.boundingBox())!.y);
    await expect(headerCreate).toBeFocused();
    await expect(page.locator('body')).not.toContainText(secret);
    await page.reload();
    await expect(row).toContainText(tokenMetadata.name);
    await expect(page.locator('body')).not.toContainText(secret);
    await expect(page.getByLabel('Access token', {exact: true})).toHaveCount(0);
    await row.getByRole('button', {name: /^Revoke /}).click();
    await expect(dialog).toContainText(tokenMetadata.name);
    await expectPhoneActions();
    await dialog.getByRole('button', {name: 'Cancel', exact: true}).click();
    expect(revokes).toBe(0);
    await row.getByRole('button', {name: /^Revoke /}).click();
    await dialog.getByRole('button', {name: 'Revoke token', exact: true}).click();
    await expect(row).toHaveCount(0);
    await expect(page.getByText('No access tokens yet.', {exact: true})).toBeVisible();
    await page.reload();
    await expect(page.getByText('No access tokens yet.', {exact: true})).toBeVisible();
    expect(creates).toBe(1);
    expect(revokes).toBe(1);
    await expectNoHorizontalOverflow(page);
  });
}

test('validates names, keeps creation open while pending, and offers manual copy when the clipboard is unavailable', async ({
  page,
}) => {
  let creates = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let releaseRefresh!: () => void;
  const refreshing = new Promise<void>((resolve) => (releaseRefresh = resolve));
  await page.route('**/personal-access-tokens', async (route) => {
    if (route.request().method() !== 'POST') {
      if (creates > 0) await refreshing;
      return route.fulfill({json: creates > 0 ? [tokenMetadata] : []});
    }
    creates++;
    await held;
    return route.fulfill({status: 201, json: {...tokenMetadata, token: secret}});
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: () => Promise.reject(new Error('Synthetic clipboard refusal')),
      },
    });
  });
  await page.goto('/settings/integrations');
  const trigger = page.getByRole('button', {name: 'Create token', exact: true});
  await trigger.click();
  const dialog = page.getByRole('dialog');
  const name = dialog.getByLabel('Name', {exact: true});
  const submit = dialog.getByRole('button', {name: 'Create token', exact: true});
  await name.fill('   ');
  await submit.click();
  await expect(dialog.getByText('Enter a token name.', {exact: true})).toBeVisible();
  await name.fill('x'.repeat(101));
  await submit.click();
  await expect(dialog.getByText('Use 100 characters or fewer.', {exact: true})).toBeVisible();
  expect(creates).toBe(0);
  await name.fill('x'.repeat(100));
  await submit.click();
  await expect(dialog.getByRole('button', {name: 'Creating…', exact: true})).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', {name: 'Cancel', exact: true})).toBeDisabled();
  release();
  await expect(dialog.getByLabel('Access token', {exact: true})).toHaveValue(secret);
  await dialog.getByRole('button', {name: 'Copy token', exact: true}).click();
  await expect(dialog.getByRole('alert')).toContainText('copy it manually');
  await expect(dialog.getByLabel('Access token', {exact: true})).toHaveValue(secret);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  releaseRefresh();
  await trigger.click();
  await expect(name).toHaveValue('');
  await expect(dialog.getByLabel('Access token', {exact: true})).toHaveCount(0);
  await dialog.getByRole('button', {name: 'Cancel', exact: true}).click();
  expect(creates).toBe(1);
});

test('a failed creation preserves the name for retry and clears the error when dismissed', async ({
  page,
}) => {
  let fail = true;
  await page.route('**/personal-access-tokens', (route) => {
    if (route.request().method() !== 'POST') return route.fulfill({json: []});
    return fail
      ? route.fulfill({status: 400, json: {message: 'Synthetic failure'}})
      : route.fulfill({status: 201, json: {...tokenMetadata, token: secret}});
  });
  await page.goto('/settings/integrations');
  const trigger = page.getByRole('button', {name: 'Create token', exact: true});
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', {exact: true}).fill(tokenMetadata.name);
  await dialog.getByRole('button', {name: 'Create token', exact: true}).click();
  await expect(dialog.getByRole('alert')).toContainText('could not be created');
  await expect(dialog.getByLabel('Name', {exact: true})).toHaveValue(tokenMetadata.name);
  await dialog.getByRole('button', {name: 'Cancel', exact: true}).click();
  await trigger.click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByLabel('Name', {exact: true})).toHaveValue('');
  fail = false;
  await dialog.getByLabel('Name', {exact: true}).fill(tokenMetadata.name);
  await dialog.getByRole('button', {name: 'Create token', exact: true}).click();
  await expect(dialog.getByLabel('Access token', {exact: true})).toHaveValue(secret);
});

test('retries a failed list load and retains a token until revocation succeeds', async ({page}) => {
  let loadFails = true;
  let revokeFails = true;
  let tokens = [
    {
      ...tokenMetadata,
      name: 'An example integration with a deliberately long synthetic name '
        .repeat(2)
        .slice(0, 100),
      lastUsedAt: '2026-01-03T12:30:00.000Z',
      expiresAt: '2026-02-01T12:00:00.000Z',
    },
    {
      ...tokenMetadata,
      id: '00000000-0000-4000-8000-000000000003',
      name: 'Example used today',
      lastUsedAt: new Date().toISOString(),
      expiresAt: null,
    },
  ];
  await page.route('**/personal-access-tokens', (route) =>
    loadFails
      ? route.fulfill({status: 429, json: {message: 'Synthetic rate limit'}})
      : route.fulfill({json: tokens}),
  );
  await page.route('**/personal-access-tokens/*', (route) => {
    if (revokeFails) return route.fulfill({status: 409, json: {message: 'Synthetic conflict'}});
    tokens = tokens.slice(1);
    return route.fulfill({status: 204});
  });
  await page.setViewportSize({width: 320, height: 900});
  await page.goto('/settings/integrations');
  await expect(page.getByText('Access tokens could not be loaded.', {exact: true})).toBeVisible();
  loadFails = false;
  await page.getByRole('button', {name: 'Try again', exact: true}).click();
  const rows = page.getByTestId('access-token-row');
  await expect(rows.nth(0).getByTestId('access-token-usage')).toHaveText(
    /^Created 2 Jan 2026·?Last used 3 Jan 2026$/,
  );
  await expect(rows.nth(0).getByTestId('access-token-expiry')).toHaveText('Expired 1 Feb 2026');
  await expect(rows.nth(1).getByTestId('access-token-usage')).toContainText('Last used today');
  await expect(rows.nth(1).getByTestId('access-token-expiry')).toHaveText('No expiration');
  const row = rows.filter({hasText: 'deliberately long synthetic name'});
  await expectNoHorizontalOverflow(page);
  await row.getByRole('button', {name: /^Revoke /}).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', {name: 'Revoke token', exact: true}).click();
  await expect(dialog.getByRole('alert')).toContainText('could not be revoked');
  await expect(row).toHaveCount(1);
  revokeFails = false;
  await dialog.getByRole('button', {name: 'Revoke token', exact: true}).click();
  await expect(row).toHaveCount(0);
});

test('reports a revocation that fails after its confirmation was closed', async ({page}) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/personal-access-tokens', (route) => route.fulfill({json: [tokenMetadata]}));
  await page.route('**/personal-access-tokens/*', async (route) => {
    await held;
    await route.fulfill({status: 409, json: {message: 'Synthetic failure'}});
  });
  await page.goto('/settings/integrations');
  const row = page.getByTestId('access-token-row');
  await row.getByRole('button', {name: /^Revoke /}).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', {name: 'Revoke token', exact: true}).click();
  await expect(dialog.getByRole('button', {name: 'Revoking…', exact: true})).toBeDisabled();
  await dialog.getByRole('button', {name: 'Close', exact: true}).first().click();
  await expect(dialog).toBeHidden();
  release();
  await expect(page.getByText('The token could not be revoked.', {exact: true})).toBeVisible();
  await expect(row).toContainText(tokenMetadata.name);
});
