import {type QueryClient, QueryObserver} from '@tanstack/react-query';

import {dashboardQueryKeys} from '../../../src/features/banking/api/aggregate-query-keys';
import {bankQueryKeys} from '../../../src/features/banking/api/query-keys';
import {recurringQueryKeys} from '../../../src/features/banking/api/recurring-query-keys';
import {createAccount} from '../../data/account.data';
import {MOCK_CONNECTION, REFRESH_RESULT, TARGET_ASPSP} from '../../data/bank-connection.data';
import {mockHistoryEndpoints} from '../../data/home-history.data';
import {API_URL, expect, test} from '../../fixtures';
import {
  EMPTY_REVIEW_COUNTS,
  fulfillJson,
  mockBankConnections,
  mockEmptyRecurringLists,
  mockJson,
  mockMerchantRanking,
  routeBankConnectionsApi,
} from '../../utils/api-mocks';
import {openDetails, openRemoval, routeMockedBankApp} from '../../utils/bank-connections';
import {createHookHarness} from '../../utils/hook-harness';

test.describe('mocked Enable Banking bank connection', () => {
  test.use({storageState: {cookies: [], origins: []}, serviceWorkers: 'block'});

  test.beforeEach(async ({page, baseURL}) => {
    await routeMockedBankApp(page, baseURL);
  });

  for (const {name, status, message} of [
    {
      name: 'a concurrent synchronization',
      status: 409,
      message: 'A bank synchronization is already in progress.',
    },
    {
      name: 'an unauthorized bank connection',
      status: 409,
      message: 'Bank connection is not authorized.',
    },
    {
      name: 'an unavailable API',
      status: 503,
      message: 'Tempo is temporarily unavailable. Please try again.',
    },
  ]) {
    test(`keeps ${name} quiet without automatically retrying the refresh`, async ({page}) => {
      let requests = 0;
      let reads = 0;
      let readsAtRefresh = Number.POSITIVE_INFINITY;
      await page.clock.install();
      await mockBankConnections(page, () => {
        reads++;
        return [MOCK_CONNECTION];
      });
      await page.route(`**/bank-connections/${MOCK_CONNECTION.id}/refresh`, (route) => {
        requests++;
        readsAtRefresh = reads;
        return fulfillJson(route, {message}, status);
      });
      await page.goto('/bank-connections');
      // The settled refresh re-reads the saved connections; by then any toast would have shown.
      await expect.poll(() => reads > readsAtRefresh).toBe(true);
      await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
      await page.clock.runFor(60_000);
      expect(requests).toBe(1);
    });
  }

  test('reports a lost refresh response once and never replays it on reconnect', async ({page}) => {
    let requests = 0;
    let unreachable = false;
    await page.clock.install();
    await routeBankConnectionsApi(page, (route) =>
      unreachable ? route.abort('failed') : fulfillJson(route, [MOCK_CONNECTION]),
    );
    await page.route(`${API_URL}/health`, (route) =>
      unreachable ? route.abort('failed') : fulfillJson(route, {}),
    );
    await page.route(`**/bank-connections/${MOCK_CONNECTION.id}/refresh`, (route) => {
      requests++;
      unreachable = true;
      return route.abort('failed');
    });
    await page.goto('/bank-connections');
    await expect.poll(() => requests).toBe(1);
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(1);
    await expect(page.locator('[data-sonner-toast]')).toContainText('Cannot reach Tempo.');
    await expect(page.getByRole('status').filter({hasText: /^Offline/})).toBeVisible();
    unreachable = false;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.clock.runFor(60_000);
    expect(requests).toBe(1);
    await page.reload();
    await expect.poll(() => requests).toBe(2);
  });

  test('handles pending and completed connection removal during foreground refresh', async ({
    page,
  }) => {
    const first = {...MOCK_CONNECTION, id: '00000000-0000-4000-8000-000000000091'};
    const requests: string[] = [];
    let reads = 0;
    let includeFirst = false;
    let removed = false;
    let removalAttempts = 0;
    let releaseRemoval!: () => void;
    const held = new Promise<void>((resolve) => (releaseRemoval = resolve));
    let releaseRefresh!: () => void;
    const refreshHeld = new Promise<void>((resolve) => (releaseRefresh = resolve));
    let releaseSecondRemoval!: () => void;
    const secondRemovalHeld = new Promise<void>((resolve) => (releaseSecondRemoval = resolve));
    await page.emulateMedia({reducedMotion: 'reduce'});
    await mockBankConnections(page, () => {
      reads++;
      return [...(includeFirst ? [first] : []), ...(removed ? [] : [MOCK_CONNECTION])];
    });
    await page.route('**/bank-connections/*/refresh', async (route) => {
      const id = new URL(route.request().url()).pathname.split('/')[2];
      requests.push(id);
      if (id === first.id) await refreshHeld;
      await fulfillJson(
        route,
        removed && id === MOCK_CONNECTION.id ? {message: 'Not found'} : REFRESH_RESULT,
        removed && id === MOCK_CONNECTION.id ? 404 : 200,
      );
    });
    await page.route(`**/bank-connections/${MOCK_CONNECTION.id}`, async (route) => {
      expect(route.request().method()).toBe('DELETE');
      removalAttempts++;
      if (removalAttempts === 1) {
        await held;
        await fulfillJson(route, {message: 'Unavailable'}, 503);
      } else {
        await secondRemovalHeld;
        removed = true;
        await route.fulfill({status: 204, body: ''});
      }
    });
    await page.goto('/bank-connections');
    const card = page.getByTestId(`bank-connection-${MOCK_CONNECTION.id}`);
    await expect.poll(() => requests).toEqual([MOCK_CONNECTION.id]);
    let dialog = await openRemoval(page, card);
    await page.getByTestId(`remove-bank-confirmation-${MOCK_CONNECTION.id}`).fill('DELETE');
    await dialog.getByRole('button', {name: 'Remove permanently', exact: true}).click();
    try {
      await expect(dialog.getByRole('button', {name: 'Removing...'})).toBeDisabled();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      const before = reads;
      await page.evaluate(() => {
        for (const value of ['hidden', 'visible']) {
          Object.defineProperty(document, 'visibilityState', {value, configurable: true});
          window.dispatchEvent(new Event('visibilitychange'));
        }
      });
      await expect.poll(() => reads).toBeGreaterThan(before);
      // Reopened while the removal is still running, the dialog shows it rather than a second one.
      dialog = await openRemoval(page, card);
      await expect(dialog.getByRole('button', {name: 'Removing...'})).toBeDisabled();
      expect(requests).toEqual([MOCK_CONNECTION.id]);
      await page.keyboard.press('Escape');
    } finally {
      releaseRemoval();
    }
    expect(removalAttempts).toBe(1);

    includeFirst = true;
    await page.evaluate(() => {
      for (const value of ['hidden', 'visible']) {
        Object.defineProperty(document, 'visibilityState', {value, configurable: true});
        window.dispatchEvent(new Event('visibilitychange'));
      }
    });
    const firstCard = page.getByTestId(`bank-connection-${first.id}`);
    let readsBeforeSettle = Number.POSITIVE_INFINITY;
    try {
      await expect.poll(() => requests).toEqual([MOCK_CONNECTION.id, first.id]);
      dialog = await openRemoval(page, card);
      await page.getByTestId(`remove-bank-confirmation-${MOCK_CONNECTION.id}`).fill('DELETE');
      await dialog.getByRole('button', {name: 'Remove permanently', exact: true}).click();
      await expect(dialog.getByRole('button', {name: 'Removing...'})).toBeDisabled();
      // Another bank opened meanwhile stays open when this removal completes.
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      const firstDetails = await openDetails(page, firstCard);
      releaseSecondRemoval();
      await expect(page.getByText('Bank connection removed', {exact: true})).toBeVisible();
      await expect(card).toHaveCount(0);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await expect(firstDetails).toHaveAttribute('data-state', 'open');
      await page.keyboard.press('Escape');
      // A settled refresh re-reads the saved connections.
      readsBeforeSettle = reads;
    } finally {
      releaseSecondRemoval();
      releaseRefresh();
    }
    await expect.poll(() => reads).toBeGreaterThan(readsBeforeSettle);
    await expect(firstCard).toBeVisible();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(requests).toEqual([MOCK_CONNECTION.id, first.id]);
  });

  test('shows an API request limit as one shared error toast with retry guidance', async ({
    page,
  }) => {
    await mockBankConnections(page, [MOCK_CONNECTION]);
    await page.route(`**/bank-connections/${MOCK_CONNECTION.id}/refresh`, (route) =>
      route.fulfill({
        status: 429,
        headers: {'Retry-After': '90'},
        contentType: 'application/json',
        body: JSON.stringify({
          statusCode: 429,
          message:
            'Bank access is temporarily rate-limited. The next automatic attempt will wait for the provider cooldown.',
          error: 'Too Many Requests',
          rateLimitSource: 'enable-banking',
          retryAfterSeconds: 90,
        }),
      }),
    );
    await page.goto('/bank-connections');
    await expect(page.getByText('Rate limit exceeded', {exact: true})).toBeVisible();
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(1);
    await expect(page.locator('[data-sonner-toast]')).toContainText(
      'Please try again in about 2 minutes.',
    );
  });

  for (const {name, body, headers, guidance} of [
    {
      name: 'uses a readable Retry-After header before JSON retry timing',
      body: '{"retryAfterSeconds":90}',
      headers: {'Retry-After': '30', 'Access-Control-Expose-Headers': 'Retry-After'},
      guidance: 'Please try again in about 30 seconds.',
    },
    {
      name: 'uses zero JSON retry timing',
      body: '{"retryAfterSeconds":0}',
      headers: undefined,
      guidance: 'Please try again in about 1 second.',
    },
    ...[
      {
        name: 'an ordinary request limit',
        body: '{"statusCode":429,"message":"Too many requests. Try again later.","error":"Too Many Requests"}',
      },
      {name: 'malformed JSON', body: '{invalid'},
      {name: 'a null body', body: 'null'},
      {name: 'nonnumeric JSON retry timing', body: '{"retryAfterSeconds":"90"}'},
      {name: 'negative JSON retry timing', body: '{"retryAfterSeconds":-1}'},
      {name: 'nonfinite JSON retry timing', body: '{"retryAfterSeconds":1e400}'},
      {name: 'unsafe JSON retry timing', body: '{"retryAfterSeconds":1e30}'},
    ].map(({name, body}) => ({
      name: `uses generic retry guidance for ${name}`,
      body,
      headers: undefined,
      guidance: 'Please try again later.',
    })),
  ]) {
    test(`${name} for a rate-limited refresh`, async ({page}) => {
      await mockBankConnections(page, [MOCK_CONNECTION]);
      await page.route(`**/bank-connections/${MOCK_CONNECTION.id}/refresh`, (route) =>
        route.fulfill({status: 429, headers, contentType: 'application/json', body}),
      );
      await page.goto('/bank-connections');
      await expect(page.getByText('Rate limit exceeded', {exact: true})).toBeVisible();
      await expect(page.locator('[data-sonner-toast]')).toHaveCount(1);
      await expect(page.locator('[data-sonner-toast]')).toContainText(guidance);
    });
  }

  test('cancels foreground refresh at logout intent and discards its late response body', async ({
    page,
    homePage,
  }) => {
    await page.addInitScript(() => {
      const fetch = window.fetch.bind(window);
      window.fetch = async (...args) => {
        const url =
          typeof args[0] === 'string'
            ? args[0]
            : args[0] instanceof URL
              ? args[0].href
              : args[0].url;
        if (url.endsWith('/refresh'))
          args[1]?.signal?.addEventListener(
            'abort',
            () => {
              document.documentElement.dataset.refreshAborted = 'true';
            },
            {once: true},
          );
        const response = await fetch(...args);
        if (response.url.endsWith('/refresh') && response.status === 429) {
          const readJson = response.json.bind(response);
          response.json = async () => {
            document.documentElement.dataset.refreshBody = 'pending';
            await new Promise<void>((resolve) =>
              window.addEventListener('release-refresh-body', () => resolve(), {once: true}),
            );
            try {
              const body: unknown = await readJson();
              return body;
            } finally {
              document.documentElement.dataset.refreshBody = 'read';
            }
          };
        }
        return response;
      };
    });
    await mockBankConnections(page, [MOCK_CONNECTION]);
    await page.route(`**/bank-connections/${MOCK_CONNECTION.id}/refresh`, (route) =>
      fulfillJson(route, {retryAfterSeconds: 90}, 429),
    );
    let releaseLogout!: () => void;
    const logoutHeld = new Promise<void>((resolve) => (releaseLogout = resolve));
    await page.route(`${API_URL}/auth/logout`, async (route) => {
      await logoutHeld;
      await fulfillJson(route, {});
    });
    await page.goto('/bank-connections');
    try {
      await expect(page.locator('html')).toHaveAttribute('data-refresh-body', 'pending');
      await homePage.logOut();
      await expect(page.locator('html')).toHaveAttribute('data-refresh-aborted', 'true');
    } finally {
      releaseLogout();
      await page.evaluate(() => window.dispatchEvent(new Event('release-refresh-body')));
    }
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator('html')).toHaveAttribute('data-refresh-body', 'read');
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(await page.getByText('Rate limit exceeded', {exact: true}).count()).toBe(0);
  });

  test('opens saved bank data offline without replaying refresh work on reconnect', async ({
    page,
  }) => {
    let requests = 0;
    await page.clock.install();
    await mockBankConnections(page, [MOCK_CONNECTION]);
    await page.route(`**/bank-connections/${MOCK_CONNECTION.id}/refresh`, (route) => {
      requests++;
      return fulfillJson(route, REFRESH_RESULT);
    });
    await page.goto('/bank-connections');
    const card = page.getByTestId(`bank-connection-${MOCK_CONNECTION.id}`);
    await expect.poll(() => requests).toBe(1);
    await expect(card).toBeVisible();
    await page.clock.runFor(1100);
    await expect
      .poll(() => page.evaluate(() => !!localStorage.getItem('tempo-offline-cache')))
      .toBe(true);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'onLine', {value: false, configurable: true});
    });
    let checkHeld = false;
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(`${API_URL}/accounts/me`, async (route) => {
      checkHeld = true;
      await held;
      await route.fallback();
    });
    await page.reload();
    await expect(card).toBeVisible();
    await expect(page.getByRole('status').filter({hasText: /^Offline/})).toBeVisible();
    expect(requests).toBe(1);
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', {value: true, configurable: true});
      window.dispatchEvent(new Event('online'));
    });
    try {
      await expect.poll(() => checkHeld).toBe(true);
      expect(requests).toBe(1);
      await expect(card).toBeVisible();
    } finally {
      release();
    }
    await page.clock.resume();
    await expect(page.getByRole('status').filter({hasText: /^Offline/})).toHaveCount(0);
    await page.clock.runFor(60_000);
    expect(requests).toBe(1);
    await page.evaluate(() => {
      for (const value of ['hidden', 'visible']) {
        Object.defineProperty(document, 'visibilityState', {value, configurable: true});
        window.dispatchEvent(new Event('visibilitychange'));
      }
    });
    await expect.poll(() => requests).toBe(2);
  });

  for (const outcome of ['conflict', 'FAILED', 'PARTIAL'] as const) {
    test(`shows expired consent discovered by a ${outcome} refresh and offers re-authorization`, async ({
      page,
    }) => {
      let expired = false;
      await mockBankConnections(page, () => [
        {
          ...MOCK_CONNECTION,
          status: expired ? 'EXPIRED' : 'AUTHORIZED',
          syncStatus: expired ? 'EXPIRED' : 'SUCCEEDED',
        },
      ]);
      await page.route(`**/bank-connections/${MOCK_CONNECTION.id}/refresh`, (route) => {
        expired = true;
        const errorMessage = 'Bank consent has expired. Please reconnect.';
        return outcome === 'conflict'
          ? fulfillJson(route, {message: errorMessage}, 409)
          : fulfillJson(route, {
              ...REFRESH_RESULT,
              status: outcome,
              errorMessage,
              transactionsAdded: outcome === 'PARTIAL' ? 1 : 0,
            });
      });
      await page.goto('/bank-connections');
      const card = page.getByTestId(`bank-connection-${MOCK_CONNECTION.id}`);
      await expect(card.getByRole('button', {name: 'Re-authorize', exact: true})).toBeVisible();
      await expect(card.getByTestId('bank-connection-problem')).toContainText('Consent expired');
      await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
    });
  }

  for (const status of ['FAILED', 'PARTIAL'] as const) {
    test(`keeps the bank rate limit of a ${status} refresh quiet without scheduling a retry`, async ({
      page,
    }) => {
      let requests = 0;
      let reads = 0;
      let readsAtRefresh = Number.POSITIVE_INFINITY;
      await page.clock.install();
      await mockBankConnections(page, () => {
        reads++;
        return [MOCK_CONNECTION];
      });
      await page.route(`**/bank-connections/${MOCK_CONNECTION.id}/refresh`, (route) => {
        requests++;
        readsAtRefresh = reads;
        return fulfillJson(route, {
          ...REFRESH_RESULT,
          status,
          transactionsAdded: status === 'PARTIAL' ? 1 : 0,
          rateLimitSource: 'enable-banking',
          retryAfterSeconds: 120,
          errorMessage: 'Example bank request limit reached.',
        });
      });
      await page.goto('/bank-connections');
      await expect.poll(() => reads > readsAtRefresh).toBe(true);
      await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
      await page.clock.runFor(180_000);
      expect(requests).toBe(1);
    });
  }

  test('refreshes the next signed-in account without dispatching the previous account tail', async ({
    page,
    homePage,
    loginPage,
  }) => {
    const next = {...MOCK_CONNECTION, id: '00000000-0000-4000-8000-000000000093'};
    const tail = {...MOCK_CONNECTION, id: '00000000-0000-4000-8000-000000000092'};
    let nextSession = false;
    const requests: string[] = [];
    await mockBankConnections(page, () => (nextSession ? [next] : [MOCK_CONNECTION, tail]));
    await mockHistoryEndpoints(page);
    await mockEmptyRecurringLists(page);
    await mockMerchantRanking(page);
    await mockJson(page, '**/recurring-series/summary?**', {
      expenseMonthlyTotal: '0.00',
      incomeMonthlyTotal: '0.00',
      expenseThisMonth: {month: '2026-10', paid: '0.00', remaining: '0.00'},
      incomeThisMonth: {month: '2026-10', paid: '0.00', remaining: '0.00'},
      upcoming: [],
      flagged: [],
      expenseUnconvertedCount: 0,
      incomeUnconvertedCount: 0,
      baseCurrency: 'EUR',
    });
    await mockJson(page, '**/bank-transactions/review-counts', EMPTY_REVIEW_COUNTS);
    await mockJson(page, '**/bank-transactions?**', {transactions: [], total: 0});
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/bank-connections/*/refresh', async (route) => {
      const id = new URL(route.request().url()).pathname.split('/')[2];
      requests.push(id);
      if (id === MOCK_CONNECTION.id) await held;
      await fulfillJson(route, REFRESH_RESULT);
    });
    await mockJson(page, `${API_URL}/auth/logout`, {});
    await page.route(`${API_URL}/auth/login`, (route) => {
      nextSession = true;
      return fulfillJson(
        route,
        createAccount({
          id: '00000000-0000-4000-8000-000000000002',
          name: 'Next Example',
          email: 'next@example.test',
        }),
      );
    });
    await page.goto('/bank-connections');
    await expect.poll(() => requests).toEqual([MOCK_CONNECTION.id]);
    try {
      await homePage.logOut();
      await expect(page).toHaveURL(/\/login$/);
      await loginPage.emailInput.fill('next@example.test');
      await loginPage.passwordInput.fill('synthetic-test-password');
      await loginPage.submitButton.click();
      await expect(page.getByTestId('account-menu-trigger')).toContainText('NE');
      await expect.poll(() => requests).toEqual([MOCK_CONNECTION.id, next.id]);
      await page
        .getByRole('navigation', {name: 'Primary'})
        .getByRole('link', {name: 'Connections', exact: true})
        .click();
      await expect(page.getByTestId(`bank-connection-${next.id}`)).toBeVisible();
    } finally {
      release();
    }
    expect(requests).toEqual([MOCK_CONNECTION.id, next.id]);
  });

  for (const [name, status, advances] of [
    ['succeeded', 'SUCCEEDED', true],
    ['failed', 'FAILED', false],
  ] as const) {
    test(`reloads Home once after ${name} refreshes of every connection on opening`, async ({
      page,
    }) => {
      const second = {...MOCK_CONNECTION, id: '00000000-0000-4000-8000-000000000097'};
      // A succeeded refresh moves its connection's last sync forward; a failed one leaves it.
      const synced = new Set<string>();
      let listReads = 0;
      await mockBankConnections(page, () => {
        listReads++;
        return [MOCK_CONNECTION, second].map((connection) => ({
          ...connection,
          lastSyncedAt: synced.has(connection.id)
            ? '2026-10-02T00:00:00.000Z'
            : '2026-10-01T00:00:00.000Z',
        }));
      });
      await mockHistoryEndpoints(page);
      await mockEmptyRecurringLists(page);
      await mockMerchantRanking(page);
      await mockJson(page, '**/recurring-series/summary?**', {
        expenseMonthlyTotal: '0.00',
        incomeMonthlyTotal: '0.00',
        expenseThisMonth: {month: '2026-10', paid: '0.00', remaining: '0.00'},
        incomeThisMonth: {month: '2026-10', paid: '0.00', remaining: '0.00'},
        upcoming: [],
        flagged: [],
        expenseUnconvertedCount: 0,
        incomeUnconvertedCount: 0,
        baseCurrency: 'EUR',
      });
      await mockJson(page, '**/bank-transactions?**', {transactions: [], total: 0});
      let reviewCountReads = 0;
      await page.route('**/bank-transactions/review-counts', (route) => {
        reviewCountReads++;
        return fulfillJson(route, EMPTY_REVIEW_COUNTS);
      });
      const requests: string[] = [];
      const releases = new Map<string, () => void>();
      const held = new Map(
        [MOCK_CONNECTION.id, second.id].map((id) => [
          id,
          new Promise<void>((resolve) => releases.set(id, resolve)),
        ]),
      );
      await page.route('**/bank-connections/*/refresh', async (route) => {
        const id = new URL(route.request().url()).pathname.split('/')[2];
        requests.push(id);
        await held.get(id);
        if (advances) synced.add(id);
        await fulfillJson(route, {...REFRESH_RESULT, status});
      });
      await page.goto('/');
      let readsBeforeRun = 0;
      try {
        await expect.poll(() => requests).toEqual([MOCK_CONNECTION.id]);
        await expect.poll(() => reviewCountReads).toBe(1);
        // Home reads the list once as it mounts, which waits for the reporting currency; count from there.
        await expect(page.getByRole('region', {name: 'Where you stand'})).toBeVisible();
        readsBeforeRun = listReads;
        releases.get(MOCK_CONNECTION.id)!();
        // The next bank starts only after the previous refresh has settled.
        await expect.poll(() => requests).toEqual([MOCK_CONNECTION.id, second.id]);
        expect(reviewCountReads).toBe(1);
        expect(listReads).toBe(readsBeforeRun);
      } finally {
        releases.forEach((release) => release());
      }
      await expect.poll(() => reviewCountReads).toBe(2);
      expect(listReads).toBe(readsBeforeRun + 1);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      expect(reviewCountReads).toBe(2);
    });
  }

  test('cancels hidden foreground work and reads current connection state on reopening', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const fetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.endsWith('/refresh')) {
          init?.signal?.addEventListener(
            'abort',
            () => {
              document.documentElement.dataset.refreshAborted = 'true';
            },
            {once: true},
          );
        }
        return fetch(input, init);
      };
    });
    const second = {...MOCK_CONNECTION, id: '00000000-0000-4000-8000-000000000095'};
    const third = {...MOCK_CONNECTION, id: '00000000-0000-4000-8000-000000000094'};
    // Waiting out a provider rate limit until its next sync, so a refresh would only be refused.
    const coolingDown = {
      ...MOCK_CONNECTION,
      id: '00000000-0000-4000-8000-000000000090',
      syncStatus: 'RATE_LIMITED' as const,
      nextSyncAt: '2999-01-01T00:00:00.000Z',
    };
    let reopened = false;
    let listReads = 0;
    const requests: string[] = [];
    await mockBankConnections(page, () => {
      listReads++;
      return reopened
        ? [
            {...MOCK_CONNECTION, syncStatus: 'RUNNING'},
            {...second, status: 'EXPIRED'},
            coolingDown,
            third,
          ]
        : [MOCK_CONNECTION, second];
    });
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/bank-connections/*/refresh', async (route) => {
      const id = new URL(route.request().url()).pathname.split('/')[2];
      requests.push(id);
      if (id === MOCK_CONNECTION.id) await held;
      await fulfillJson(route, REFRESH_RESULT);
    });
    await page.goto('/bank-connections');
    await expect.poll(() => requests).toEqual([MOCK_CONNECTION.id]);
    try {
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', {value: 'hidden', configurable: true});
        window.dispatchEvent(new Event('visibilitychange'));
      });
      await expect(page.locator('html')).toHaveAttribute('data-refresh-aborted', 'true');
      expect(requests).toEqual([MOCK_CONNECTION.id]);
      expect(await page.locator('[data-sonner-toast]').count()).toBe(0);
      expect(
        await page
          .getByRole('status')
          .filter({hasText: /^Offline/})
          .count(),
      ).toBe(0);
      reopened = true;
      const readsBefore = listReads;
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', {value: 'visible', configurable: true});
        window.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('visibilitychange'));
      });
      await expect.poll(() => requests).toEqual([MOCK_CONNECTION.id, third.id]);
      expect(listReads).toBeGreaterThan(readsBefore);
    } finally {
      release();
    }
  });

  test('refreshes once per visible opening and retries a failed bank on reopening', async ({
    page,
  }) => {
    let requests = 0;
    let reads = 0;
    let readsAtRefresh = Number.POSITIVE_INFINITY;
    await mockBankConnections(page, () => {
      reads++;
      return [MOCK_CONNECTION];
    });
    await page.route(`**/bank-connections/${MOCK_CONNECTION.id}/refresh`, (route) => {
      requests++;
      readsAtRefresh = reads;
      return fulfillJson(
        route,
        requests === 1
          ? {
              ...REFRESH_RESULT,
              status: 'FAILED',
              transactionsAdded: 0,
              errorMessage: 'Example bank is unavailable.',
            }
          : REFRESH_RESULT,
      );
    });
    await page.goto('/bank-connections');
    const card = page.getByTestId(`bank-connection-${MOCK_CONNECTION.id}`);
    await expect.poll(() => reads > readsAtRefresh).toBe(true);
    expect(requests).toBe(1);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('online'));
      window.dispatchEvent(new Event('visibilitychange'));
    });
    await page.getByTestId('account-menu-trigger').click();
    await page.getByRole('menuitem', {name: 'Settings'}).click();
    await page.getByRole('link', {name: 'Connections', exact: true}).click();
    await expect(card).toBeVisible();
    expect(requests).toBe(1);
    await page.evaluate(() => {
      for (const value of ['hidden', 'visible']) {
        Object.defineProperty(document, 'visibilityState', {value, configurable: true});
        window.dispatchEvent(new Event('visibilitychange'));
      }
    });
    await expect.poll(() => requests).toBe(2);
  });

  test('stays silent when the API skips a bank that synchronized moments ago', async ({page}) => {
    let requests = 0;
    let reads = 0;
    let readsAtSkip = Number.POSITIVE_INFINITY;
    await mockBankConnections(page, () => {
      reads++;
      return [MOCK_CONNECTION];
    });
    await page.route(`**/bank-connections/${MOCK_CONNECTION.id}/refresh`, (route) => {
      requests++;
      readsAtSkip = reads;
      return route.fulfill({status: 204, body: ''});
    });
    await page.goto('/bank-connections');
    const card = page.getByTestId(`bank-connection-${MOCK_CONNECTION.id}`);
    await expect.poll(() => requests).toBe(1);
    // The settled refresh re-reads the saved connections; by then any toast would have shown.
    await expect.poll(() => reads).toBeGreaterThan(readsAtSkip);
    await expect(card.getByTestId('bank-connection-total')).toBeVisible();
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  });

  test('shows the balances a partial refresh saved without a toast', async ({page}) => {
    let completed = false;
    await mockBankConnections(page, () => [
      {
        ...MOCK_CONNECTION,
        bankAccounts: MOCK_CONNECTION.bankAccounts.map((account) => ({
          ...account,
          currentBalanceAmount: completed ? '1000.00' : account.currentBalanceAmount,
        })),
      },
    ]);
    await page.route(`**/bank-connections/${MOCK_CONNECTION.id}/refresh`, async (route) => {
      completed = true;
      await fulfillJson(route, {
        ...REFRESH_RESULT,
        status: 'PARTIAL',
        transactionsAdded: 1,
        errorMessage: 'Example account is unavailable.',
      });
    });
    await page.goto('/bank-connections');
    const card = page.getByTestId(`bank-connection-${MOCK_CONNECTION.id}`);
    await expect(card.getByTestId('bank-connection-total')).toContainText('2,000.00');
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  });
});

test.describe('bank-derived caches', () => {
  test.use({storageState: {cookies: [], origins: []}});

  test('bank-derived invalidation updates every bank-derived cache and reuses fresh supported banks', async () => {
    const {client, load} = createHookHarness({});
    const keys = [
      bankQueryKeys.transactions({cashFlows: ['SPENDING']}, undefined),
      bankQueryKeys.transaction('example-transaction'),
      dashboardQueryKeys.breakdown('year', 'category', '2007-01-01', '2026-10-01', '2026-10-01'),
      dashboardQueryKeys.balanceTrend('month', '2026-01-01', '2026-10-01', '2026-10-01'),
      dashboardQueryKeys.cashFlow('month', '2026-01-01', '2026-10-01', '2026-10-01'),
      dashboardQueryKeys.reviewCounts,
      recurringQueryKeys.lists('2026-10-01'),
      recurringQueryKeys.summary('2026-10-01'),
    ];
    keys.forEach((key) => client.setQueryData(key, {revision: 0}));
    client.setQueryData(bankQueryKeys.supportedBanks, [TARGET_ASPSP]);
    let catalogReads = 0;
    const catalogObserver = new QueryObserver(client, {
      queryKey: bankQueryKeys.supportedBanks,
      staleTime: 60 * 60_000,
      queryFn: () => {
        catalogReads++;
        return Promise.resolve([TARGET_ASPSP]);
      },
    });
    const unsubscribeCatalog = catalogObserver.subscribe(() => {});
    const unrelated = ['example-unrelated'];
    client.setQueryData(unrelated, {revision: 0});
    let reads = 0;
    const observer = new QueryObserver(client, {
      queryKey: dashboardQueryKeys.reviewCounts,
      queryFn: () => Promise.resolve({revision: ++reads}),
    });
    const unsubscribe = observer.subscribe(() => {});
    try {
      const {invalidateBankDerivedData} = load(
        'src/features/banking/api/invalidate-bank-derived-data.ts',
      ) as {invalidateBankDerivedData: (client: QueryClient) => Promise<unknown>};
      await invalidateBankDerivedData(client);
      expect(catalogReads).toBe(0);
      expect(client.getQueryState(bankQueryKeys.supportedBanks)?.isInvalidated).toBe(false);
      expect(client.getQueryData(dashboardQueryKeys.reviewCounts)).toEqual({revision: 1});
      for (const key of keys.filter((key) => key !== dashboardQueryKeys.reviewCounts))
        expect(client.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true);
      expect(client.getQueryState(unrelated)?.isInvalidated).toBe(false);
    } finally {
      unsubscribeCatalog();
      unsubscribe();
      client.clear();
    }
  });
});
