import type {CreatedPersonalAccessToken} from '../../../src/features/settings/types/personal-access-token';
import {API_URL, expect, test} from '../../fixtures';

// This journey uses the paired API implementation, not browser-intercepted token responses.
test.use({storageState: {cookies: [], origins: []}});

test('a signed-in account creates a one-time token and revokes its read-only access', async ({
  page,
  freshAccount,
  browserName,
}) => {
  // Only Chromium lets a test read the clipboard back; WebKit still runs the copy itself.
  const canReadClipboard = browserName === 'chromium';
  if (canReadClipboard)
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/settings/integrations');
  await expect(page.getByTestId('current-account-email')).toHaveText(freshAccount.email);
  await expect(page.getByText('No access tokens yet.', {exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Create token', exact: true}).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', {exact: true}).fill('Example API integration');
  const createdResponse = page.waitForResponse(
    (response) =>
      response.url() === `${API_URL}/personal-access-tokens` &&
      response.request().method() === 'POST',
  );
  await dialog.getByRole('button', {name: 'Create token', exact: true}).click();
  const created = await createdResponse;
  expect(created.status()).toBe(201);
  const metadata = (await created.json()) as CreatedPersonalAccessToken;
  const secret = metadata.token;
  expect(secret).toBeTruthy();
  await expect(dialog.getByLabel('Access token', {exact: true})).toHaveValue(secret);
  await dialog.getByRole('button', {name: 'Copy token', exact: true}).click();
  await expect(dialog.getByRole('button', {name: 'Copied', exact: true})).toBeVisible();
  if (canReadClipboard) {
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(secret);
  }
  const bearerHeaders = {Authorization: `Bearer ${secret}`};
  expect(
    (await page.request.get(`${API_URL}/bank-connections`, {headers: bearerHeaders})).status(),
  ).toBe(200);
  await dialog.getByRole('button', {name: 'Done', exact: true}).click();
  await expect(dialog).toBeHidden();
  const row = page.getByTestId('access-token-row');
  await expect(row).toContainText('Example API integration');
  await row.getByRole('button', {name: 'View Example API integration', exact: true}).click();
  const details = page.getByRole('dialog', {name: 'Example API integration', exact: true});
  await expect(details).toContainText(metadata.prefix);
  await expect(details).not.toContainText(secret);
  await page.keyboard.press('Escape');
  await expect(details).toBeHidden();
  await expect(page.locator('body')).not.toContainText(secret);
  await page.reload();
  await expect(row).toContainText('Example API integration');
  await expect(page.getByLabel('Access token', {exact: true})).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(secret);
  expect(
    JSON.stringify(await page.evaluate(() => ({...localStorage, ...sessionStorage}))),
  ).not.toContain(secret);
  const listed = await page.request.get(`${API_URL}/personal-access-tokens`);
  expect(listed.status()).toBe(200);
  expect(await listed.json()).toEqual([
    expect.objectContaining({id: metadata.id, scopes: ['read']}),
  ]);
  expect(await listed.text()).not.toContain(secret);
  await row.getByRole('button', {name: /^Revoke /}).click();
  const revokedResponse = page.waitForResponse(
    (response) =>
      response.url() === `${API_URL}/personal-access-tokens/${metadata.id}` &&
      response.request().method() === 'DELETE',
  );
  await dialog.getByRole('button', {name: 'Revoke token', exact: true}).click();
  expect((await revokedResponse).status()).toBe(204);
  await expect(row).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('No access tokens yet.', {exact: true})).toBeVisible();
  expect(await (await page.request.get(`${API_URL}/personal-access-tokens`)).json()).toEqual([]);
  expect(
    (await page.request.get(`${API_URL}/bank-connections`, {headers: bearerHeaders})).status(),
  ).toBe(401);
});
