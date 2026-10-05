import type {Page, Request, Route} from '@playwright/test';

import type {BankConnection} from '../../../src/features/banking/types/bank-connection';
import {VERIFIED_USER_AUTH_FILE} from '../../constants/auth.constants';
import {API_URL, createVerifiedAccount, expect, test} from '../../fixtures';
import {HomePage} from '../../pages/home.page';
import {LoginPage} from '../../pages/login.page';
import {SecuritySettingsPage} from '../../pages/security-settings.page';
import {SignupPage} from '../../pages/signup.page';
import {
  fulfillJson,
  mockJson,
  routeBankConnectionsApi,
  transformBankConnections,
} from '../../utils/api-mocks';
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
const savedStatus = (page: Page) => page.getByRole('status').filter({hasText: /^Offline/});
const unreachableHeading = (page: Page) => page.getByRole('heading', {name: 'Cannot reach Tempo'});
const serverSessionStatus = async (page: Page) =>
  (await page.request.get(`${API_URL}/accounts/me`)).status();
/**
 * Runs the persister's throttled save (at most 1 s away), so a skipped or late write has had its
 * chance. Needs `clock.install()` before the page loads.
 */
const flushPersistence = (page: Page) => page.clock.runFor(1000);
const logoutLocks = (page: Page) =>
  page.evaluate(async () => {
    const {held = [], pending = []} = await navigator.locks.query();
    const count = (locks: LockInfo[]) => locks.filter(({name}) => name === 'tempo-logout').length;
    return {held: count(held), pending: count(pending)};
  });
const nameSaveOutcome = (page: Page) =>
  page.getByText(/^(Name saved\.|Your name could not be saved\. Please try again)$/);

/** Brings the tab back into view, which refetches the page's data as switching apps does. */
const refocus = (page: Page) =>
  page.evaluate(() => {
    for (const state of ['hidden', 'visible']) {
      Object.defineProperty(document, 'visibilityState', {value: state, configurable: true});
      window.dispatchEvent(new Event('visibilitychange'));
    }
  });

/** Adds a second account to the first connection, so the bank account filter is shown. */
function withSecondAccount(connections: BankConnection[]) {
  const [first] = connections;
  first.bankAccounts = [
    ...first.bankAccounts,
    {
      ...first.bankAccounts[0],
      id: '00000000-0000-4000-8000-000000000097',
      name: 'Secondary account',
      alias: 'Secondary spending',
    },
  ];
  return connections;
}

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
  await expect(unreachableHeading(page)).toBeVisible();
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
      if (requests++ > 0) return fulfillJson(route, {message: 'Unavailable'}, 503);
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

  test.describe('when Tempo stops answering', () => {
    let failedRequests: string[] = [];
    const apiRequests = `${API_URL}/**`;
    const failRequest = (route: Route) => {
      failedRequests.push(new URL(route.request().url()).pathname);
      return route.abort('failed');
    };
    /** Fails every API request without a response. Added last, so it overrides the test's routes. */
    const loseConnection = async (page: Page) => {
      failedRequests = [];
      await page.route(apiRequests, failRequest);
      await refocus(page);
    };
    const restoreConnection = (page: Page) => page.unroute(apiRequests, failRequest);

    const abnAmroCard = (page: Page) =>
      page
        .locator('[data-testid^="bank-connection-"]')
        .filter({has: page.getByRole('heading', {name: 'ABN AMRO'})});
    const unavailableTransactions = (page: Page) =>
      page.getByText(/Recent transactions are unavailable/);
    const failedTransactionRequests = () =>
      failedRequests.filter((path) => path.endsWith('/transactions')).length;

    test('keeps the recent transactions of an expanded card and refreshes them on reconnect', async ({
      page,
    }) => {
      test.setTimeout(25000);
      await page.goto('/bank-connections');
      const card = abnAmroCard(page);
      await card.getByRole('button', {name: /ABN AMRO/}).click();
      await expect(card.getByText('Provider purchase')).toBeVisible();
      let refreshed = false;
      await page.route('**/bank-connections/*/transactions**', async (route) => {
        refreshed = true;
        await route.continue();
      });

      await loseConnection(page);
      await expect.poll(failedTransactionRequests).toBeGreaterThan(0);
      await expect(savedStatus(page)).toBeVisible();
      await expect(card.getByText('Provider purchase')).toBeVisible();
      await expect(unavailableTransactions(page)).not.toBeVisible();

      await restoreConnection(page);
      await expect(savedStatus(page)).not.toBeVisible({timeout: 15000});
      await expect.poll(() => refreshed).toBe(true);
      await expect(card.getByText('Provider purchase')).toBeVisible();
      await expect(unavailableTransactions(page)).not.toBeVisible();
    });

    test('reports transactions that were never loaded as unavailable until Tempo answers', async ({
      page,
    }) => {
      test.setTimeout(25000);
      await page.goto('/bank-connections');
      const card = abnAmroCard(page);
      await expect(card).toBeVisible();

      await loseConnection(page);
      await expect(savedStatus(page)).toBeVisible();
      await card.getByRole('button', {name: /ABN AMRO/}).click();
      await expect(unavailableTransactions(page)).toBeVisible();
      await expect(card.getByRole('status', {name: 'Loading recent transactions'})).toHaveCount(0);
      await expect(card.getByText('Provider purchase')).not.toBeVisible();

      await restoreConnection(page);
      await expect(savedStatus(page)).not.toBeVisible({timeout: 15000});
      await expect(card.getByText('Provider purchase')).toBeVisible();
      await expect(unavailableTransactions(page)).not.toBeVisible();
    });

    test('still reports a failed transaction refresh when Tempo answers with an error', async ({
      page,
    }) => {
      await page.goto('/bank-connections');
      const card = abnAmroCard(page);
      await card.getByRole('button', {name: /ABN AMRO/}).click();
      await expect(card.getByText('Provider purchase')).toBeVisible();
      await mockJson(page, '**/bank-connections/*/transactions**', {message: 'Unavailable'}, 503);

      await refocus(page);
      await expect(unavailableTransactions(page)).toBeVisible();
      await expect(card.getByRole('button', {name: 'Try again'})).toBeVisible();
      await expect(card.getByText('Provider purchase')).not.toBeVisible();
      await expect(savedStatus(page)).not.toBeVisible();
    });

    test('keeps the loaded bank account filter usable and refreshes it on reconnect', async ({
      page,
    }) => {
      test.setTimeout(25000);
      let connectionRequests = 0;
      await transformBankConnections(page, (connections) => {
        connectionRequests++;
        return withSecondAccount(connections);
      });
      await page.goto('/bank-transactions');
      const filter = page.getByRole('button', {name: /^Bank accounts/});
      await filter.click();
      await page.getByRole('option', {name: /Daily spending/}).click();
      await expect(page).toHaveURL(/bankAccountIds/);
      await page.keyboard.press('Escape');
      await expect(filter).toContainText('Daily spending');
      const loadedRequests = connectionRequests;

      await loseConnection(page);
      await expect.poll(() => failedRequests).toContain('/bank-connections');
      await expect(savedStatus(page)).toBeVisible();
      await expect(filter).toBeEnabled();
      await expect(filter).toContainText('Daily spending');
      await filter.click();
      await expect(page.getByRole('option', {name: /Secondary spending/})).toBeVisible();
      await page.keyboard.press('Escape');

      await restoreConnection(page);
      await expect(savedStatus(page)).not.toBeVisible({timeout: 15000});
      await expect.poll(() => connectionRequests).toBeGreaterThan(loadedRequests);
      await expect(filter).toBeEnabled();
      await expect(filter).toContainText('Daily spending');
    });

    test('keeps the bank account filter unavailable when accounts never loaded', async ({page}) => {
      await routeBankConnectionsApi(page, (route) => route.abort('failed'));
      // Keep the reconnect probe failing too, so the app does not come back online mid-test.
      await page.route('**/health', (route) => route.abort('failed'));
      await page.goto('/bank-transactions');
      await expect(page.getByText('Coffee shop')).toBeVisible();
      await expect(savedStatus(page)).toBeVisible();
      await expect(page.getByRole('button', {name: /^Bank accounts/})).toBeDisabled();
    });

    test('disables the loaded bank account filter when Tempo answers with an error', async ({
      page,
    }) => {
      let failing = false;
      await routeBankConnectionsApi(page, async (route) => {
        if (failing) return fulfillJson(route, {message: 'Unavailable'}, 503);
        const response = await route.fetch();
        await route.fulfill({
          response,
          json: withSecondAccount((await response.json()) as BankConnection[]),
        });
      });
      await page.goto('/bank-transactions');
      const filter = page.getByRole('button', {name: /^Bank accounts/});
      await expect(filter).toBeEnabled();

      failing = true;
      await refocus(page);
      await expect(filter).toBeDisabled();
      await expect(savedStatus(page)).not.toBeVisible();
    });
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
    await expect(unreachableHeading(page)).toBeVisible();
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
    await expect(unreachableHeading(page)).toBeVisible();
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
  await expect(page).toHaveURL(/\/login$/);
  expect(errors).toEqual([]);
  await page.reload();
  await expect(unreachableHeading(page)).toBeVisible();
});

test('asks for a secure connection where the browser has no Web Locks', async ({
  page,
  freshAccount,
  homePage,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(homePage.sidebarAccountName).toHaveText(freshAccount.name);
  await expect.poll(() => readCache(page)).not.toBe(null);
  // Browsers withhold Web Locks on plain HTTP origins other than localhost.
  await page.addInitScript(() => {
    delete (Navigator.prototype as {locks?: unknown}).locks;
  });
  const apiRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith(API_URL)) apiRequests.push(request.url());
  });
  await page.reload();
  await expect(page.getByRole('heading', {name: 'Tempo needs a secure connection'})).toBeVisible();
  await expect(homePage.sidebarAccountName).not.toBeVisible();
  await expect(page.getByText(freshAccount.name)).not.toBeVisible();
  expect(apiRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test('a signed-out tab does not sign out a tab that logs in', async ({
  page,
  context,
  freshAccount,
  homePage,
}) => {
  await context.clock.install();
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
  await flushPersistence(other);
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
    .poll(() => serverSessionStatus(page), {
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
    .poll(() => serverSessionStatus(page), {
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
  const otherHome = new HomePage(other);
  await other.goto('/');
  await expect(otherHome.sidebarAccountName).toHaveText(freshAccount.name);
  await context.setOffline(true);
  await expect(savedStatus(page)).toBeVisible();
  await homePage.logOut();
  await expect.poll(() => readCache(page)).toBe(null);
  let requests = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await context.route('**/auth/logout', async (route) => {
    requests++;
    const response = await route.fetch();
    await held;
    await route.fulfill({response});
  });
  await context.setOffline(false);
  // One tab's logout is in flight while the other waits for it.
  await expect.poll(() => logoutLocks(page)).toEqual({held: 1, pending: 1});
  await expect.poll(() => requests).toBe(1);
  release();
  await expect.poll(() => logoutLocks(page)).toEqual({held: 0, pending: 0});
  expect(requests).toBe(1);
  for (const tab of [page, other])
    expect(await tab.evaluate(() => localStorage.getItem('tempo-pending-logout'))).toBe(null);
  expect(await serverSessionStatus(page)).toBe(401);
  await expect(homePage.sidebarAccountName).not.toBeVisible();
  await expect(otherHome.sidebarAccountName).not.toBeVisible();
});

test('an account save finishing after logout in another tab does not restore saved data', async ({
  page,
  context,
  freshAccount,
  homePage,
}) => {
  await context.clock.install();
  await page.goto('/settings/account');
  const name = page.getByTestId('name-input');
  await expect(name).toHaveValue(freshAccount.name);
  await expect.poll(() => readCache(page)).not.toBe(null);
  let releaseSave!: () => void;
  const saveReleased = new Promise<void>((resolve) => (releaseSave = resolve));
  let saveHeld = false;
  await page.route('**/accounts/me', async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    const current = (await (await route.fetch({method: 'GET'})).json()) as object;
    saveHeld = true;
    await saveReleased;
    await route.fulfill({json: {...current, name: 'Late example'}});
  });
  await name.fill('Late example');
  await name.blur();
  await expect.poll(() => saveHeld).toBe(true);

  const other = await context.newPage();
  await other.goto('/');
  await new HomePage(other).logOut();
  await expect(other).toHaveURL(/\/login$/);
  await expect.poll(() => readCache(page)).toBe(null);
  await expect(homePage.sidebarAccountName).not.toBeVisible();

  releaseSave();
  await expect(nameSaveOutcome(page)).toBeVisible();
  await flushPersistence(page);
  expect(await readCache(page)).toBe(null);
  await expect(homePage.sidebarAccountName).not.toBeVisible();
});

test('a save finishing after logout and a new login does not sign out the new account', async ({
  page,
  request,
  freshAccount,
  homePage,
  loginPage,
}) => {
  const next = await createVerifiedAccount(request);
  await page.goto('/settings/account');
  const name = page.getByTestId('name-input');
  await expect(name).toHaveValue(freshAccount.name);
  let releaseSave!: () => void;
  const saveReleased = new Promise<void>((resolve) => (releaseSave = resolve));
  let saveHeld = false;
  await page.route('**/accounts/me', async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    saveHeld = true;
    await saveReleased;
    // The previous account's session has ended by the time the save is answered.
    await fulfillJson(route, {message: 'Unauthorized'}, 401);
  });
  await name.fill('Late example');
  await name.blur();
  await expect.poll(() => saveHeld).toBe(true);
  await homePage.logOut();
  // Log in on the page that is open: reloading it would cancel the held save.
  await loginPage.emailInput.fill(next.email);
  await loginPage.passwordInput.fill(next.password);
  await loginPage.submitButton.click();
  await expect(homePage.sidebarAccountName).toHaveText(next.name);
  await expect.poll(() => readCache(page)).not.toBe(null);

  releaseSave();
  // A 401 that signs out is handled, and the saved data removed, before the save reports failure.
  await expect(nameSaveOutcome(page)).toHaveText(/could not be saved/);
  expect(await readCache(page)).not.toBe(null);
  await expect(page).not.toHaveURL(/\/login$/);
  await expect(homePage.sidebarAccountName).toHaveText(next.name);
  expect(await serverSessionStatus(page)).toBe(200);
});

test('logout clears saved data in other open tabs too', async ({
  page,
  context,
  freshAccount,
  homePage,
}) => {
  await page.goto('/');
  await expect(homePage.sidebarAccountName).toHaveText(freshAccount.name);
  await expect.poll(() => readCache(page)).not.toBe(null);
  const other = await context.newPage();
  const otherHome = new HomePage(other);
  await other.goto('/');
  await expect(otherHome.sidebarAccountName).toHaveText(freshAccount.name);
  await homePage.logOut();
  await expect(page).toHaveURL(/\/login$/);
  await expect(otherHome.sidebarAccountName).not.toBeVisible();
  await expect.poll(() => readCache(other)).toBe(null);
  await expect(other).toHaveURL(/\/login$/);
});

test('a logout in another tab leaves a signed-out tab where it is', async ({
  page,
  context,
  freshAccount,
  homePage,
}) => {
  await context.clearCookies();
  const other = new SignupPage(await context.newPage());
  await other.navigate();
  await other.nameInput.fill('Example Person');
  await new LoginPage(page).login(freshAccount.email, freshAccount.password);
  await expect(homePage.sidebarAccountName).toHaveText(freshAccount.name);
  await expect.poll(() => readCache(page)).not.toBe(null);
  // Registered after the app's own listener, so it fires once the app has handled the logout.
  await other.page.evaluate((key) => {
    window.addEventListener('storage', (event) => {
      if (event.key === key && event.newValue === null) document.body.dataset.cacheRemoved = '';
    });
  }, CACHE_KEY);
  await homePage.logOut();
  await expect(page).toHaveURL(/\/login$/);
  await expect(other.page.locator('body[data-cache-removed]')).toBeAttached();
  await expect(other.page).toHaveURL(/\/signup$/);
  await expect(other.nameInput).toHaveValue('Example Person');
});

test('a session check answered after a logout in another tab does not sign that tab in', async ({
  page,
  context,
  freshAccount,
  homePage,
}) => {
  await context.clock.install();
  const other = await context.newPage();
  const otherHome = new HomePage(other);
  let releaseCheck!: () => void;
  const checkReleased = new Promise<void>((resolve) => (releaseCheck = resolve));
  let heldCheck: Request | undefined;
  let checks = 0;
  await other.route('**/accounts/me', async (route) => {
    if (route.request().method() !== 'GET' || checks++ > 0) return route.fallback();
    // The check reaches Tempo while the session is valid; its reply arrives after the logout.
    const response = await route.fetch();
    heldCheck = route.request();
    await checkReleased;
    await route.fulfill({response});
  });
  void other.goto('/');
  await expect.poll(() => !!heldCheck).toBe(true);

  await page.goto('/');
  await expect(homePage.sidebarAccountName).toHaveText(freshAccount.name);
  await expect.poll(() => readCache(page)).not.toBe(null);
  await homePage.logOut();
  await expect(page).toHaveURL(/\/login$/);
  // The other tab asks again after the logout instead of waiting for the held check.
  await expect.poll(() => checks).toBe(2);
  await expect(other).toHaveURL(/\/login$/);

  const checkFinished = other.waitForEvent('requestfinished', (r) => r === heldCheck);
  releaseCheck();
  await checkFinished;
  await flushPersistence(other);
  await expect(other).toHaveURL(/\/login$/);
  await expect(otherHome.sidebarAccountName).not.toBeVisible();
  expect(await readCache(other)).toBe(null);
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
  await context.clock.install();
  await page.goto('/bank-transactions');
  await expect(homePage.sidebarAccountName).toHaveText(freshAccount.name);
  await expect.poll(() => readCache(page)).not.toBe(null);
  let releaseAccount!: () => void;
  const accountReleased = new Promise<void>((resolve) => (releaseAccount = resolve));
  let markAccountHeld!: (request: Request) => void;
  const accountHeld = new Promise<Request>((resolve) => (markAccountHeld = resolve));
  await page.route('**/accounts/me', async (route) => {
    const response = await route.fetch();
    markAccountHeld(route.request());
    await accountReleased;
    await route.fulfill({response});
  });
  // Reconnecting refetches the session and the page together; the page's 401 lands first, while
  // the session check's successful reply is still held.
  await page.route(`${API_URL}/bank-transactions?**`, async (route) => {
    await accountHeld;
    await fulfillJson(route, {message: 'Unauthorized'}, 401);
  });
  await context.setOffline(true);
  await expect(savedStatus(page)).toBeVisible();
  await context.setOffline(false);
  await expect(page).toHaveURL(/\/login$/);
  await expect.poll(() => readCache(page)).toBe(null);
  const heldCheck = await accountHeld;
  const checkFinished = page.waitForEvent('requestfinished', (r) => r === heldCheck);
  releaseAccount();
  await checkFinished;
  await flushPersistence(page);
  expect(await readCache(page)).toBe(null);
  await expect(page).toHaveURL(/\/login$/);
  await expect(new LoginPage(page).submitButton).toBeVisible();
});

test('an actual revoked session clears saved data instead of granting offline access', async ({
  page,
  context,
  freshAccount,
  homePage,
}) => {
  await page.goto('/');
  await expect(homePage.sidebarAccountName).toHaveText(freshAccount.name);
  await expect.poll(() => readCache(page)).not.toBe(null);
  const revoked = await page.request.post(`${API_URL}/auth/logout`);
  expect(revoked.status()).toBe(200);
  await page.reload();
  await expect(page).toHaveURL(/\/login$/);
  await expect.poll(() => readCache(page)).toBe(null);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(unreachableHeading(page)).toBeVisible();
  await expect(homePage.sidebarAccountName).not.toBeVisible();
});
