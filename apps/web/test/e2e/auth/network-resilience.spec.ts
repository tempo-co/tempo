import type {Page} from '@playwright/test';

import {VERIFIED_USER_AUTH_FILE} from '../../constants/auth.constants';
import {API_URL, expect, test} from '../../fixtures';
import {HomePage} from '../../pages/home.page';
import {LoginPage} from '../../pages/login.page';
import {SecuritySettingsPage} from '../../pages/security-settings.page';
import {routeBankConnectionsApi} from '../../utils/api-mocks';
import {expectNoHorizontalOverflow} from '../../utils/layout';

const CACHE_KEY = 'tempo-offline-cache';
type SavedCache = {
  timestamp: number;
  clientState: {queries: {queryKey: string[]; state: {dataUpdatedAt: number}}[]};
};
const readCache = (page: Page) =>
  page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? 'null') as SavedCache | null,
    CACHE_KEY,
  );
const savedStatus = (page: Page) =>
  page.getByRole('status').filter({hasText: 'Showing saved data'});

async function saveTransactions(page: Page) {
  await page.goto('/bank-transactions');
  await expect(page.getByText('Coffee shop')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect
    .poll(() =>
      readCache(page).then(
        (cache) =>
          cache?.clientState.queries.some((query) => query.queryKey[0] === 'bank-transactions') ??
          false,
      ),
    )
    .toBe(true);
}

test('does not send an unreachable session check to login', async ({page}) => {
  await page.route('**/accounts/me', (route) => route.abort('failed'));
  await page.goto('/bank-transactions');
  await expect(page.getByRole('heading', {name: 'Cannot reach Tempo'})).toBeVisible();
  await expect(page).toHaveURL(/\/bank-transactions(?:\?|$)/);
  await expect(page.getByRole('button', {name: 'Try again'})).toBeVisible();
});

test.describe('saved app', () => {
  test.use({storageState: VERIFIED_USER_AUTH_FILE});

  test('opens saved transactions on a phone-width offline reload and new tab', async ({
    page,
    context,
  }) => {
    test.setTimeout(25000);
    await page.setViewportSize({width: 393, height: 852});
    await saveTransactions(page);
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByText('Coffee shop')).toBeVisible();
    await expect(savedStatus(page)).toBeVisible();
    await expectNoHorizontalOverflow(page);
    const reopened = await context.newPage();
    await reopened.goto('/bank-transactions');
    await expect(reopened.getByText('Coffee shop')).toBeVisible();
    await reopened.close();
    await context.setOffline(false);
    await expect(savedStatus(page)).not.toBeVisible({timeout: 15000});
  });

  test('keeps saved data while the server is unreachable despite browser connectivity', async ({
    page,
  }) => {
    test.setTimeout(25000);
    await saveTransactions(page);
    let unavailable = true;
    for (const endpoint of ['accounts/me', 'health']) {
      await page.route(`**/${endpoint}`, (route) =>
        unavailable ? route.abort('failed') : route.continue(),
      );
    }
    await page.reload();
    await expect(savedStatus(page)).toBeVisible();
    await expect(page.getByText('Coffee shop')).toBeVisible();
    await expect(page).toHaveURL(/\/bank-transactions(?:\?|$)/);
    unavailable = false;
    await expect(savedStatus(page)).not.toBeVisible({timeout: 15000});
    await expect(page.getByText('Coffee shop')).toBeVisible();
  });

  test('keeps loaded bank connections visible when a refresh fails', async ({page}) => {
    // A queued sync makes the page poll; every poll after the first load fails.
    let requests = 0;
    await routeBankConnectionsApi(page, async (route) => {
      if (requests++ > 0) return route.abort('failed');
      const connections = (await (await route.fetch()).json()) as {syncStatus: string}[];
      await route.fulfill({json: connections.map((c) => ({...c, syncStatus: 'QUEUED'}))});
    });
    await page.goto('/bank-connections');
    const cards = page.locator('[data-testid^="connection-card-toggle-"]');
    await expect(cards.first()).toBeVisible();
    await expect.poll(() => requests, {timeout: 12_000}).toBeGreaterThan(1);
    await expect(savedStatus(page)).toBeVisible();
    await expect(cards.first()).toBeVisible();
    await expect(page.getByText('Could not load bank connections')).not.toBeVisible();
  });

  test('still reports a failed refresh when Tempo answers with an error', async ({page}) => {
    let requests = 0;
    await routeBankConnectionsApi(page, async (route) => {
      if (requests++ > 0) return route.fulfill({status: 503, json: {message: 'Unavailable'}});
      const connections = (await (await route.fetch()).json()) as {syncStatus: string}[];
      await route.fulfill({json: connections.map((c) => ({...c, syncStatus: 'QUEUED'}))});
    });
    await page.goto('/bank-connections');
    await expect(page.locator('[data-testid^="connection-card-toggle-"]').first()).toBeVisible();
    await expect.poll(() => requests, {timeout: 12_000}).toBeGreaterThan(1);
    await expect(
      page.getByRole('heading', {name: 'Could not load bank connections'}),
    ).toBeVisible();
    await expect(savedStatus(page)).not.toBeVisible();
  });

  test('removes saved data from a tab left offline past the saved-data limit', async ({
    page,
    context,
  }) => {
    await page.clock.install();
    await saveTransactions(page);
    await context.setOffline(true);
    await expect(savedStatus(page)).toBeVisible();
    await page.clock.fastForward('25:00:00');
    await expect(page.getByRole('heading', {name: 'Cannot reach Tempo'})).toBeVisible();
    await expect(page.getByText('Coffee shop')).not.toBeVisible();
    await expect.poll(() => readCache(page)).toBe(null);
  });

  test('rejects expired account data even if the cache was saved recently', async ({
    page,
    context,
  }) => {
    await saveTransactions(page);
    await page.evaluate((key) => {
      const cache = JSON.parse(localStorage.getItem(key)!) as SavedCache;
      for (const query of cache.clientState.queries)
        query.state.dataUpdatedAt = Date.now() - 25 * 60 * 60 * 1000;
      localStorage.setItem(key, JSON.stringify(cache));
    }, CACHE_KEY);
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', {name: 'Cannot reach Tempo'})).toBeVisible();
    await expect(page.getByText('Coffee shop')).not.toBeVisible();
  });

  test('does not cache API responses, session identifiers or arbitrary resources in the shell', async ({
    page,
    context,
  }) => {
    await saveTransactions(page);
    let sessionsLoadedAt = Infinity;
    await page.route('**/auth/sessions', async (route) => {
      const response = await route.fetch();
      sessionsLoadedAt = Date.now();
      await route.fulfill({response});
    });
    await page.goto('/settings/security');
    await expect(new SecuritySettingsPage(page).currentSessionCard).toBeVisible();
    // Wait for a save made after the sessions loaded, so their absence is not just a stale snapshot.
    await expect
      .poll(async () => ((await readCache(page))?.timestamp ?? 0) > sessionsLoadedAt)
      .toBe(true);
    const cachedPaths = await page.evaluate(async () => {
      const paths: string[] = [];
      for (const name of await caches.keys()) {
        if (!name.startsWith('tempo-shell-')) continue;
        const cache = await caches.open(name);
        for (const request of await cache.keys()) paths.push(new URL(request.url).pathname);
      }
      return paths;
    });
    expect(cachedPaths).toContain('/index.html');
    expect(
      cachedPaths.every(
        (path) =>
          path === '/index.html' ||
          path === '/manifest.webmanifest' ||
          path.startsWith('/assets/') ||
          /\.(png|svg)$/.test(path),
      ),
    ).toBe(true);
    const savedRoots = (await readCache(page))!.clientState.queries.map(
      (query) => query.queryKey[0],
    );
    expect(savedRoots).not.toContain('sessions');
    await context.setOffline(true);
    expect(
      await page.evaluate(async () => {
        try {
          await fetch('/private-export.json');
          return true;
        } catch {
          return false;
        }
      }),
    ).toBe(false);
  });
});

test('logging out while Tempo is unreachable still clears saved data', async ({
  page,
  context,
  freshAccount,
  homePage,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(homePage.sidebarAccountName).toHaveText(freshAccount.name);
  await expect.poll(() => readCache(page)).not.toBe(null);
  await context.setOffline(true);
  await expect(savedStatus(page)).toBeVisible();
  await homePage.logOut();
  await expect.poll(() => readCache(page)).toBe(null);
  await expect(homePage.sidebarAccountName).not.toBeVisible();
  await expect(page.getByText('Saved data was removed from this device')).toBeVisible();
  expect(errors).toEqual([]);
  await page.reload();
  await expect(page.getByRole('heading', {name: 'Cannot reach Tempo'})).toBeVisible();
});

test('a signed-out tab does not sign out a tab that logs in', async ({
  page,
  context,
  freshAccount,
  homePage,
}) => {
  await context.clearCookies();
  const other = await context.newPage();
  const otherLogin = new LoginPage(other);
  await otherLogin.navigate();
  await expect(otherLogin.submitButton).toBeVisible();
  await new LoginPage(page).login(freshAccount.email, freshAccount.password);
  await expect(homePage.sidebarAccountName).toHaveText(freshAccount.name);
  await expect.poll(() => readCache(page)).not.toBe(null);

  // Any activity in the signed-out tab, such as a failed sign-in, saves its own (empty) state.
  await otherLogin.emailInput.fill('nobody@example.com');
  await otherLogin.passwordInput.fill('not-the-password');
  await otherLogin.submitButton.click();
  await expect(otherLogin.invalidCredentialsError).toBeVisible();
  await page.waitForTimeout(1500);
  expect(await readCache(page)).not.toBe(null);
  await expect(homePage.sidebarAccountName).toHaveText(freshAccount.name);
});

test('a logout that could not reach Tempo is completed once it is reachable again', async ({
  page,
  context,
  freshAccount,
  homePage,
}) => {
  test.setTimeout(30000);
  await page.goto('/bank-transactions');
  await expect(homePage.sidebarAccountName).toHaveText(freshAccount.name);
  await expect.poll(() => readCache(page)).not.toBe(null);
  await context.setOffline(true);
  await expect(savedStatus(page)).toBeVisible();
  await homePage.logOut();
  await expect.poll(() => readCache(page)).toBe(null);

  await context.setOffline(false);
  // The server session ends, so neither this tab nor a reload signs the user back in.
  await expect
    .poll(async () => (await page.request.get(`${API_URL}/accounts/me`)).status(), {
      timeout: 20_000,
    })
    .toBe(401);
  await expect(homePage.sidebarAccountName).not.toBeVisible();
  expect(await readCache(page)).toBe(null);
  await page.reload();
  await expect(page).toHaveURL(/\/login$/);
  await expect(homePage.sidebarAccountName).not.toBeVisible();
});

test('logout clears private data even when its pending marker cannot be stored', async ({
  page,
  context,
  freshAccount,
  homePage,
}) => {
  await page.goto('/');
  await expect(homePage.sidebarAccountName).toHaveText(freshAccount.name);
  await expect.poll(() => readCache(page)).not.toBe(null);
  await page.evaluate(() => {
    const original = Object.getOwnPropertyDescriptor(Storage.prototype, 'setItem')!.value as (
      this: Storage,
      key: string,
      value: string,
    ) => void;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'tempo-pending-logout') throw new DOMException('Full', 'QuotaExceededError');
      original.call(this, key, value);
    };
  });
  await context.setOffline(true);
  await expect(savedStatus(page)).toBeVisible();
  await homePage.logOut();
  await expect.poll(() => readCache(page)).toBe(null);
  await expect(homePage.sidebarAccountName).not.toBeVisible();
  await context.setOffline(false);
  await expect
    .poll(async () => (await page.request.get(`${API_URL}/accounts/me`)).status(), {
      timeout: 20_000,
    })
    .toBe(401);
});

test('two reconnecting tabs finish a pending logout only once', async ({
  page,
  context,
  freshAccount,
  homePage,
}) => {
  test.setTimeout(30000);
  await page.goto('/');
  await expect(homePage.sidebarAccountName).toHaveText(freshAccount.name);
  const other = await context.newPage();
  await other.goto('/');
  await expect(other.getByTestId('sidebar-current-account-name')).toHaveText(freshAccount.name);
  await context.setOffline(true);
  await expect(savedStatus(page)).toBeVisible();
  await homePage.logOut();
  await expect.poll(() => readCache(page)).toBe(null);
  let requests = 0;
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await context.route('**/auth/logout', async (route) => {
    requests++;
    const response = await route.fetch();
    await held;
    await route.fulfill({response});
  });
  await context.setOffline(false);
  await expect.poll(() => requests).toBeGreaterThan(0);
  // Keep the first logout in flight while both tabs process reconnection.
  await page.waitForTimeout(2000);
  const concurrentRequests = requests;
  release();
  expect(concurrentRequests).toBe(1);
  await expect
    .poll(async () => (await page.request.get(`${API_URL}/accounts/me`)).status())
    .toBe(401);
  await expect(homePage.sidebarAccountName).not.toBeVisible();
  await expect(other.getByTestId('sidebar-current-account-name')).not.toBeVisible();
});

test('an account save finishing after logout in another tab does not restore saved data', async ({
  page,
  context,
  freshAccount,
  homePage,
}) => {
  await page.goto('/settings/account');
  const name = page.getByTestId('name-input');
  await expect(name).toHaveValue(freshAccount.name);
  await expect.poll(() => readCache(page)).not.toBe(null);
  let releaseSave = () => {};
  let saveStarted = false;
  await page.route('**/accounts/me', async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    saveStarted = true;
    const current = (await (await route.fetch({method: 'GET'})).json()) as object;
    await new Promise<void>((resolve) => (releaseSave = resolve));
    await route.fulfill({json: {...current, name: 'Late example'}});
  });
  await name.fill('Late example');
  await name.blur();
  await expect.poll(() => saveStarted).toBe(true);

  const other = await context.newPage();
  await other.goto('/');
  await new HomePage(other).logOut();
  await expect(other).toHaveURL(/\/login$/);
  await expect.poll(() => readCache(page)).toBe(null);
  await expect(homePage.sidebarAccountName).not.toBeVisible();

  releaseSave();
  await page.waitForTimeout(1500);
  expect(await readCache(page)).toBe(null);
  await expect(homePage.sidebarAccountName).not.toBeVisible();
});

test('logout clears saved data in other open tabs too', async ({
  page,
  context,
  freshAccount,
  homePage,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('sidebar-current-account-name')).toHaveText(freshAccount.name);
  await expect
    .poll(() => page.evaluate((key) => !!localStorage.getItem(key), CACHE_KEY))
    .toBe(true);
  const other = await context.newPage();
  await other.goto('/');
  await expect(other.getByTestId('sidebar-current-account-name')).toHaveText(freshAccount.name);
  await homePage.logOut();
  await expect(page).toHaveURL(/\/login$/);
  await expect(other.getByTestId('sidebar-current-account-name')).not.toBeVisible();
  await expect.poll(() => other.evaluate((key) => localStorage.getItem(key), CACHE_KEY)).toBe(null);
});

test('does not queue an offline account change for replay after reconnect', async ({
  page,
  context,
  freshAccount,
}) => {
  test.setTimeout(20000);
  await page.goto('/settings/account');
  const name = page.getByTestId('name-input');
  await expect(name).toHaveValue(freshAccount.name);
  let writes = 0;
  page.on('request', (request) => {
    if (request.method() === 'PATCH' && request.url().endsWith('/accounts/me')) writes++;
  });
  await context.setOffline(true);
  await expect(savedStatus(page)).toBeVisible();
  await name.fill('Offline example');
  await name.blur();
  await expect(
    page.getByText('Changes cannot be saved while Tempo is unreachable.', {exact: true}),
  ).toBeVisible();
  expect(writes).toBe(0);
  await context.setOffline(false);
  await expect(savedStatus(page)).not.toBeVisible({timeout: 15000});
  const account = await page.request.get(`${API_URL}/accounts/me`);
  expect(((await account.json()) as {name: string}).name).toBe(freshAccount.name);
  expect(writes).toBe(0);
});

test('a session check started before a real 401 cannot restore saved data', async ({
  page,
  context,
  freshAccount,
  homePage,
}) => {
  await page.goto('/bank-transactions');
  await expect(homePage.sidebarAccountName).toHaveText(freshAccount.name);
  await expect.poll(() => readCache(page)).not.toBe(null);
  let releaseAccount = () => {};
  await page.route('**/accounts/me', async (route) => {
    const response = await route.fetch();
    await new Promise<void>((resolve) => (releaseAccount = resolve));
    await route.fulfill({response});
  });
  await page.route(`${API_URL}/bank-transactions?**`, (route) =>
    route.fulfill({status: 401, json: {message: 'Unauthorized'}}),
  );
  // Reconnecting refetches the session and the page together; the page's 401 lands first.
  await context.setOffline(true);
  await expect(savedStatus(page)).toBeVisible();
  await context.setOffline(false);
  await expect(page).toHaveURL(/\/login$/);
  await expect.poll(() => readCache(page)).toBe(null);
  releaseAccount();
  await page.waitForTimeout(1500);
  expect(await readCache(page)).toBe(null);
  await expect(page).toHaveURL(/\/login$/);
});

test('an actual revoked session clears saved data instead of granting offline access', async ({
  page,
  context,
  freshAccount,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('sidebar-current-account-name')).toHaveText(freshAccount.name);
  await expect
    .poll(() => page.evaluate((key) => !!localStorage.getItem(key), CACHE_KEY))
    .toBe(true);
  const revoked = await page.request.post(`${API_URL}/auth/logout`);
  expect(revoked.status()).toBe(200);
  await page.reload();
  await expect(page).toHaveURL(/\/login$/);
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), CACHE_KEY)).toBe(null);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', {name: 'Cannot reach Tempo'})).toBeVisible();
  await expect(page.getByTestId('sidebar-current-account-name')).not.toBeVisible();
});
