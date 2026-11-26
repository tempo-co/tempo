import type {Page, Request, Route} from '@playwright/test';
import type {NotificationSettings} from '@tempo/contracts';

import {createAccount} from '../../data/account.data';
import {API_URL, expect, test} from '../../fixtures';
import {EMPTY_REVIEW_COUNTS, mockJson} from '../../utils/api-mocks';

// A throwaway VAPID public key; the browser's push service is replaced below.
const PUBLIC_KEY =
  'BE9REd2wuwnXNoYqo5snAjISJAwtTxv9Y3vH7d8WU9xUcmm7iivjJ6eypA8yRl59qfLWC9mWQIg-cgrpoaiq2zA';
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/example-device';
const KEYS = {p256dh: 'BExampleP256dhKey', auth: 'ExampleAuthKey'};
const account = createAccount({
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Alex Example',
  email: 'alex@example.com',
});
const settings = (overrides: Partial<NotificationSettings> = {}): NotificationSettings => ({
  publicKey: PUBLIC_KEY,
  preferences: {bankConnections: true},
  ...overrides,
});

type PushStub = {
  permission: NotificationPermission;
  /** What the next permission prompt answers. */
  answer: NotificationPermission;
  permissionRequests: number;
  subscribed: boolean;
  /** How many subscribe calls fail first, as iPhone and iPad may fail one that no click started. */
  subscribeRefusals: number;
  /** Subscribe calls wait until `window.__release()` releases the oldest waiting call. */
  holdSubscribe: boolean;
  /** Waiting for `navigator.serviceWorker.ready` waits the same way. */
  holdReady: boolean;
  /** Calls waiting for a release. */
  held: number;
  subscribeCalls: number;
  subscribeKeyLength: number | null;
  badges: number[];
};

/**
 * Replaces the browser's notification permission, push manager and app badge, so the flow runs the same in every
 * browser without a push service. The state lives on `window.__push`; `setPushOnLoad` changes how later page loads
 * start.
 */
async function stubPush(page: Page, initial: Partial<PushStub> = {}) {
  await page.addInitScript(
    ({initial, endpoint, keys}) => {
      const state: PushStub = {
        permission: 'default',
        answer: 'granted',
        permissionRequests: 0,
        subscribed: false,
        subscribeRefusals: 0,
        holdSubscribe: false,
        holdReady: false,
        held: 0,
        subscribeCalls: 0,
        subscribeKeyLength: null,
        badges: [],
        ...initial,
        ...(JSON.parse(sessionStorage.getItem('push-stub') ?? '{}') as Partial<PushStub>),
      };
      const waiting: (() => void)[] = [];
      const hold = () => {
        state.held++;
        return new Promise<void>((release) => waiting.push(release));
      };
      Object.assign(window, {
        __push: state,
        __release: () => {
          state.held--;
          waiting.shift()?.();
        },
      });
      const subscription = {
        endpoint,
        toJSON: () => ({endpoint, keys}),
        unsubscribe: () => {
          state.subscribed = false;
          return Promise.resolve(true);
        },
      };
      const pushManager = {
        getSubscription: () => Promise.resolve(state.subscribed ? subscription : null),
        subscribe: async ({applicationServerKey}: {applicationServerKey: Uint8Array}) => {
          state.subscribeCalls++;
          if (state.holdSubscribe) await hold();
          if (state.subscribeRefusals > 0) {
            state.subscribeRefusals--;
            throw new DOMException('Subscribing needs a click.', 'NotAllowedError');
          }
          state.subscribeKeyLength = applicationServerKey.length;
          state.subscribed = true;
          return subscription;
        },
      };
      const registration = {pushManager};
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: {
          get ready() {
            return state.holdReady
              ? hold().then(() => registration)
              : Promise.resolve(registration);
          },
          getRegistration: () => Promise.resolve(registration),
          register: () => Promise.resolve(registration),
          controller: null,
          addEventListener: () => undefined,
        },
      });
      class FakeNotification {
        static get permission() {
          return state.permission;
        }
        static requestPermission() {
          state.permissionRequests++;
          state.permission = state.answer;
          return Promise.resolve(state.permission);
        }
      }
      Object.assign(window, {Notification: FakeNotification, PushManager: class {}});
      Object.assign(navigator, {
        setAppBadge: (count: number) => Promise.resolve(void state.badges.push(count)),
        clearAppBadge: () => Promise.resolve(void state.badges.push(0)),
      });
    },
    {initial, endpoint: ENDPOINT, keys: KEYS},
  );
}

const setPushOnLoad = (page: Page, values: Partial<PushStub>) =>
  page.evaluate((values) => sessionStorage.setItem('push-stub', JSON.stringify(values)), values);

const pushState = (page: Page) =>
  page.evaluate(() => (window as unknown as {__push: PushStub}).__push);

/** Records requests to the subscription route and answers them. */
async function recordSubscriptionRequests(page: Page) {
  const requests: {method: string; body: unknown}[] = [];
  await page.route(`${API_URL}/notifications/subscriptions`, (route) => {
    const request: Request = route.request();
    requests.push({method: request.method(), body: request.postDataJSON()});
    return route.fulfill({status: 204});
  });
  return requests;
}

/** Toasts disappear on their own, so this records every one shown on later page loads. */
async function recordToasts(page: Page) {
  await page.addInitScript(() => {
    const toasts: string[] = [];
    Object.assign(window, {__toasts: toasts});
    new MutationObserver(() => {
      for (const toast of document.querySelectorAll('[data-sonner-toast]')) {
        if (!toasts.includes(toast.textContent ?? '')) toasts.push(toast.textContent ?? '');
      }
    }).observe(document, {childList: true, subtree: true});
  });
  return () => page.evaluate(() => (window as unknown as {__toasts: string[]}).__toasts);
}

const deviceRow = (page: Page) =>
  page.getByRole('region', {name: 'Notifications', exact: true}).getByRole('status');

test.use({storageState: {cookies: [], origins: []}});

test.beforeEach(async ({page}) => {
  await page.route('**/accounts/me', (route) => route.fulfill({json: account}));
});

test.describe('Notification settings', () => {
  test('allows notifications only from the button, registers this device and turns it off again', async ({
    page,
  }) => {
    await stubPush(page);
    await mockJson(page, `${API_URL}/notifications`, settings());
    const requests = await recordSubscriptionRequests(page);

    await page.goto('/settings/account');
    await expect(deviceRow(page)).toHaveText('Off.');
    expect((await pushState(page)).permissionRequests).toBe(0);

    const allow = page.getByRole('button', {name: 'Allow notifications'});
    await allow.click();
    await expect(deviceRow(page)).toHaveText('On. Alerts you have turned on arrive here.');
    const state = await pushState(page);
    expect(state.permissionRequests).toBe(1);
    // The server key decodes to an uncompressed P-256 point.
    expect(state.subscribeKeyLength).toBe(65);
    expect(requests).toEqual([{method: 'PUT', body: {endpoint: ENDPOINT, keys: KEYS}}]);

    await page.getByRole('button', {name: 'Turn off'}).click();
    await expect(deviceRow(page)).toHaveText('Off.');
    expect((await pushState(page)).subscribed).toBe(false);
    expect(requests[requests.length - 1]).toEqual({method: 'DELETE', body: {endpoint: ENDPOINT}});
  });

  test('subscribes again without asking when the subscription is gone but notifications are allowed, unless this device was turned off', async ({
    page,
  }) => {
    // Each page load starts with no subscription, as after clearing site data; localStorage survives reloads here.
    await stubPush(page, {permission: 'granted'});
    await mockJson(page, `${API_URL}/notifications`, settings());
    const requests = await recordSubscriptionRequests(page);
    const put = {method: 'PUT', body: {endpoint: ENDPOINT, keys: KEYS}};

    await page.goto('/settings/account');
    await expect(deviceRow(page)).toHaveText('On. Alerts you have turned on arrive here.');
    expect(requests).toEqual([put]);
    expect((await pushState(page)).permissionRequests).toBe(0);

    await page.getByRole('button', {name: 'Turn off'}).click();
    await expect(deviceRow(page)).toHaveText('Off.');
    await expect.poll(() => requests.length).toBe(2);

    await page.reload();
    await expect(deviceRow(page)).toHaveText('Off.');
    await page.waitForTimeout(1000);
    expect((await pushState(page)).subscribed).toBe(false);
    expect(requests).toHaveLength(2);

    await page.getByRole('button', {name: 'Allow notifications'}).click();
    await expect(deviceRow(page)).toHaveText('On. Alerts you have turned on arrive here.');
    expect(requests).toEqual([put, {method: 'DELETE', body: {endpoint: ENDPOINT}}, put]);

    await page.reload();
    await expect(deviceRow(page)).toHaveText('On. Alerts you have turned on arrive here.');
    await expect.poll(() => requests.length).toBe(4);
    expect(requests[3]).toEqual(put);
    expect((await pushState(page)).permissionRequests).toBe(0);
  });

  test('with bank alerts off, a device without a subscription stays off until they are turned on', async ({
    page,
  }) => {
    await stubPush(page, {permission: 'granted'});
    let bankConnections = false;
    await page.route(`${API_URL}/notifications`, (route) =>
      route.fulfill({json: settings({preferences: {bankConnections}})}),
    );
    await page.route(`${API_URL}/notifications/preferences`, (route) => {
      bankConnections = true;
      return route.fulfill({json: settings({preferences: {bankConnections}})});
    });
    const requests = await recordSubscriptionRequests(page);

    await page.goto('/settings/account');
    await expect(deviceRow(page)).toHaveText('Off.');
    await page.waitForTimeout(1000);
    expect(requests).toEqual([]);

    await page.getByRole('checkbox', {name: /Bank alerts/}).click();
    await expect(deviceRow(page)).toHaveText('On. Alerts you have turned on arrive here.');
    expect(requests).toEqual([{method: 'PUT', body: {endpoint: ENDPOINT, keys: KEYS}}]);
    expect((await pushState(page)).permissionRequests).toBe(0);
  });

  test('a browser that refuses to subscribe on its own shows no error and Allow notifications still works', async ({
    page,
  }) => {
    await stubPush(page, {permission: 'granted', subscribeRefusals: 1});
    await mockJson(page, `${API_URL}/notifications`, settings());
    const requests = await recordSubscriptionRequests(page);
    const toasts = await recordToasts(page);

    await page.goto('/settings/account');
    await expect.poll(async () => (await pushState(page)).subscribeCalls).toBe(1);
    await expect(deviceRow(page)).toHaveText('Off.');
    expect(await toasts()).toEqual([]);
    expect(requests).toEqual([]);

    await page.getByRole('button', {name: 'Allow notifications'}).click();
    await expect(deviceRow(page)).toHaveText('On. Alerts you have turned on arrive here.');
    expect(requests).toEqual([{method: 'PUT', body: {endpoint: ENDPOINT, keys: KEYS}}]);
  });

  for (const {failure, fail} of [
    {
      failure: 'the connection drops',
      fail: (route: Route) => route.abort('internetdisconnected'),
    },
    {
      failure: 'the session has ended',
      fail: (route: Route) => route.fulfill({status: 401, json: {message: 'Unauthorized'}}),
    },
    {
      failure: 'Tempo is rate limited',
      fail: (route: Route) => route.fulfill({status: 429, json: {message: 'Too many requests'}}),
    },
  ]) {
    test(`when ${failure} while registering this device, nothing is shown and the device stays off`, async ({
      page,
    }) => {
      await stubPush(page, {permission: 'granted'});
      await mockJson(page, `${API_URL}/notifications`, settings());
      const requests = await recordSubscriptionRequests(page);
      const toasts = await recordToasts(page);
      let failed = false;
      await page.route(`${API_URL}/notifications/subscriptions`, (route) => {
        if (failed) return route.fallback();
        failed = true;
        return fail(route);
      });

      await page.goto('/settings/account');
      await expect.poll(() => failed).toBe(true);
      await expect(deviceRow(page)).toHaveText('Off.');
      expect((await pushState(page)).subscribed).toBe(false);
      expect(await toasts()).toEqual([]);
      expect(requests).toEqual([]);

      // A subscription the browser kept fails to register the same quiet way when Tempo opens, then succeeds.
      await setPushOnLoad(page, {subscribed: true});
      failed = false;
      await page.reload();
      await expect.poll(() => failed).toBe(true);
      await page.waitForTimeout(500);
      expect(await toasts()).toEqual([]);
      expect(requests).toEqual([]);

      await page.reload();
      await expect
        .poll(() => requests)
        .toEqual([{method: 'PUT', body: {endpoint: ENDPOINT, keys: KEYS}}]);
    });
  }

  test('a device subscribed again while Tempo is offline sends nothing, shows no error and stays off', async ({
    page,
    context,
  }) => {
    await stubPush(page, {permission: 'granted', holdSubscribe: true});
    await mockJson(page, `${API_URL}/notifications`, settings());
    const requests = await recordSubscriptionRequests(page);
    const toasts = await recordToasts(page);

    await page.goto('/settings/account');
    await expect.poll(async () => (await pushState(page)).subscribeCalls).toBe(1);
    await context.setOffline(true);
    await expect(page.getByRole('status').filter({hasText: /^Offline/})).toBeVisible();
    await page.evaluate(() => (window as unknown as {__release: () => void}).__release());
    await expect.poll(async () => (await pushState(page)).subscribeKeyLength).toBe(65);
    await expect.poll(async () => (await pushState(page)).subscribed).toBe(false);
    await expect(deviceRow(page)).toHaveText('Off.');
    expect(await toasts()).toEqual([]);
    expect(requests).toEqual([]);
  });

  for (const {step, hold, subscribeCalls} of [
    {step: 'waits for the service worker', hold: 'holdReady', subscribeCalls: 0},
    {step: 'is subscribing', hold: 'holdSubscribe', subscribeCalls: 1},
  ] as const) {
    for (const interruption of ['logging out', 'turning bank alerts off'] as const) {
      test(`${interruption} while this device ${step} to get alerts again registers nothing and leaves it unsubscribed`, async ({
        page,
      }) => {
        await stubPush(page, {permission: 'granted'});
        const held: (() => void)[] = [];
        const holdUntilReleased = () => new Promise<void>((release) => held.push(release));
        await page.route(`${API_URL}/notifications`, async (route) => {
          await holdUntilReleased();
          return route.fulfill({json: settings()});
        });
        await page.route(`${API_URL}/notifications/preferences`, (route) =>
          route.fulfill({json: settings({preferences: {bankConnections: false}})}),
        );
        const requests = await recordSubscriptionRequests(page);
        await page.route(`${API_URL}/auth/logout`, async (route) => {
          await holdUntilReleased();
          return route.fulfill({json: {message: 'Logged out.'}});
        });

        try {
          await page.goto('/settings/account');
          await expect.poll(() => held.length).toBe(1);
          await page.evaluate((hold) => {
            (window as unknown as {__push: PushStub}).__push[hold] = true;
          }, hold);
          held.shift()!();
          await expect.poll(async () => (await pushState(page)).held).toBe(1);

          if (interruption === 'logging out') {
            await page.getByTestId('account-menu-trigger').click();
            await page.getByTestId('log-out-button').click();
            // The attempt goes on while Tempo confirms the logout.
            await expect.poll(() => held.length).toBe(1);
          } else {
            const banks = page.getByRole('checkbox', {name: /Bank alerts/});
            await banks.click();
            await expect(banks).not.toBeChecked();
          }
          await page.evaluate((hold) => {
            const push = window as unknown as {__push: PushStub; __release: () => void};
            push.__push[hold] = false;
            push.__release();
          }, hold);
          await page.waitForTimeout(500);
          held.shift()?.();
          if (interruption === 'logging out') await expect(page).toHaveURL(/\/login/);

          const state = await pushState(page);
          expect(state.subscribeCalls).toBe(subscribeCalls);
          expect(state.subscribed).toBe(false);
          expect(requests).toEqual([]);
        } finally {
          for (const release of held) release();
        }
      });
    }
  }

  test('says how to unblock notifications when permission is refused', async ({page}) => {
    await stubPush(page, {answer: 'denied'});
    await mockJson(page, `${API_URL}/notifications`, settings());
    const requests = await recordSubscriptionRequests(page);

    await page.goto('/settings/account');
    await page.getByRole('button', {name: 'Allow notifications'}).click();

    await expect(deviceRow(page)).toHaveText(
      'Notifications are blocked for Tempo. Allow them in this browser’s site settings, then come back here.',
    );
    await expect(page.getByRole('button', {name: 'Allow notifications'})).toHaveCount(0);
    expect(requests).toEqual([]);
  });

  test('says when this server sends no notifications', async ({page}) => {
    await stubPush(page);
    await mockJson(page, `${API_URL}/notifications`, settings({publicKey: null}));

    await page.goto('/settings/account');

    await expect(deviceRow(page)).toHaveText(
      'This Tempo server isn’t set up to send notifications.',
    );
    await expect(page.getByRole('button', {name: 'Allow notifications'})).toHaveCount(0);
    await expect(page.getByRole('checkbox', {name: /Bank alerts/})).toHaveCount(0);
  });

  for (const {device, userAgent, status} of [
    {
      device: 'an iPhone browser tab',
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      status:
        'On iPhone and iPad, add Tempo to your Home Screen first: tap Share, then Add to Home Screen, and open Tempo from there.',
    },
    {
      device: 'an iPhone before iOS 16.4',
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1',
      status: 'Notifications need iOS 16.4 or later. Update this device to turn them on.',
    },
    {
      device: 'an Android browser tab',
      userAgent:
        'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36',
      status:
        'On Android, install Tempo first: open the browser menu, choose Install app, and open Tempo from your home screen.',
    },
  ]) {
    test.describe(`on ${device}`, () => {
      test.use({userAgent});

      test('explains what to do instead of offering the button, and subscribes nothing on its own', async ({
        page,
      }) => {
        await stubPush(page, {permission: 'granted'});
        await mockJson(page, `${API_URL}/notifications`, settings());
        const requests = await recordSubscriptionRequests(page);

        await page.goto('/settings/account');

        await expect(deviceRow(page)).toHaveText(status);
        await expect(page.getByRole('button', {name: 'Allow notifications'})).toHaveCount(0);
        await page.waitForTimeout(1000);
        expect((await pushState(page)).subscribeCalls).toBe(0);
        expect(requests).toEqual([]);
      });
    });
  }

  test('saves the bank alert choice and puts it back when the save fails', async ({page}) => {
    await stubPush(page);
    await mockJson(page, `${API_URL}/notifications`, settings());
    const saves: unknown[] = [];
    let fail = false;
    await page.route(`${API_URL}/notifications/preferences`, async (route) => {
      saves.push(route.request().postDataJSON());
      if (fail) return route.fulfill({status: 500, json: {message: 'Internal server error'}});
      return route.fulfill({json: settings({preferences: {bankConnections: false}})});
    });

    await page.goto('/settings/account');
    const alerts = page.getByRole('region', {name: 'Notifications', exact: true});
    await expect(alerts.getByRole('checkbox')).toHaveCount(1);
    const banks = alerts.getByRole('checkbox', {name: /Bank alerts/});
    await expect(banks).toBeChecked();

    await banks.click();
    await expect(banks).not.toBeChecked();
    expect(saves).toEqual([{bankConnections: false}]);

    fail = true;
    await banks.click();
    await expect(page.getByText('The alert setting could not be saved.')).toBeVisible();
    await expect(banks).not.toBeChecked();
    expect(saves).toEqual([{bankConnections: false}, {bankConnections: true}]);
  });

  test('the app icon counts transactions to review, and logging out clears it and this device', async ({
    page,
  }) => {
    await stubPush(page, {permission: 'granted', subscribed: true});
    await mockJson(page, `${API_URL}/notifications`, settings());
    await mockJson(page, '**/bank-transactions/review-counts', {
      ...EMPTY_REVIEW_COUNTS,
      needsReview: 2,
      categorizationFailed: 1,
      needsAttention: 2,
    });
    const requests = await recordSubscriptionRequests(page);
    let loggedOut = false;
    await page.route('**/accounts/me', (route) =>
      loggedOut
        ? route.fulfill({status: 401, json: {message: 'Unauthorized'}})
        : route.fulfill({json: account}),
    );
    await page.route(`${API_URL}/auth/logout`, (route) => {
      loggedOut = true;
      return route.fulfill({json: {message: 'Logged out.'}});
    });

    await page.goto('/settings/account');
    await expect(deviceRow(page)).toHaveText('On. Alerts you have turned on arrive here.');
    // One row can need attention for several reasons; the icon counts it once, like the tab.
    await expect.poll(async () => (await pushState(page)).badges).toEqual([2]);
    // An already subscribed browser is registered with this session.
    expect(requests).toEqual([{method: 'PUT', body: {endpoint: ENDPOINT, keys: KEYS}}]);

    await page.getByTestId('account-menu-trigger').click();
    await page.getByTestId('log-out-button').click();
    await expect(page).toHaveURL(/\/login/);
    await expect.poll(async () => (await pushState(page)).badges.slice(-1)[0]).toBe(0);
    expect((await pushState(page)).subscribed).toBe(false);
    // A logged-out device stays unsubscribed although notifications are still allowed.
    await page.waitForTimeout(1000);
    expect((await pushState(page)).subscribed).toBe(false);
    expect(requests).toHaveLength(1);

    // Signing in again resumes this device's alerts without asking.
    await setPushOnLoad(page, {subscribed: false});
    loggedOut = false;
    await page.goto('/settings/account');
    await expect(deviceRow(page)).toHaveText('On. Alerts you have turned on arrive here.');
    expect(requests).toEqual([
      {method: 'PUT', body: {endpoint: ENDPOINT, keys: KEYS}},
      {method: 'PUT', body: {endpoint: ENDPOINT, keys: KEYS}},
    ]);
    expect((await pushState(page)).permissionRequests).toBe(0);
  });
  test('a subscribed device opened while Tempo is unreachable registers nothing and shows no error', async ({
    page,
  }) => {
    await stubPush(page, {permission: 'granted', subscribed: true});
    await mockJson(page, `${API_URL}/notifications`, settings());
    const requests = await recordSubscriptionRequests(page);
    await page.goto('/settings/account');
    await expect(deviceRow(page)).toHaveText('On. Alerts you have turned on arrive here.');
    await expect.poll(() => requests.length).toBe(1);
    // The saved account lets Tempo open without a connection.
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('wisp-offline-cache')))
      .not.toBeNull();

    await page.route(`${API_URL}/**`, (route) => route.abort('internetdisconnected'));
    const attempts: string[] = [];
    page.on('request', (request) => {
      if (request.url().endsWith('/notifications/subscriptions')) attempts.push(request.method());
    });
    const toasts = await recordToasts(page);
    await page.reload();

    await expect(page.getByRole('status').filter({hasText: /^Offline/})).toBeVisible();
    // The subscription check that would register this device has had time to run.
    await expect.poll(async () => (await pushState(page)).permission).toBe('granted');
    await page.waitForTimeout(1000);
    expect(await toasts()).toEqual([]);
    expect(attempts).toEqual([]);
  });

  test.describe('on a screen without the notification settings', () => {
    /** Answers the alert settings read with `answer` and counts the reads. */
    async function countSettingsReads(page: Page, answer: (route: Route) => Promise<void>) {
      const reads = {count: 0};
      await page.route(`${API_URL}/notifications`, (route) => {
        reads.count++;
        return answer(route);
      });
      return reads;
    }

    test('a refused settings read restores nothing and shows nothing', async ({page}) => {
      await stubPush(page, {permission: 'granted'});
      const reads = await countSettingsReads(page, (route) =>
        route.fulfill({status: 429, json: {message: 'Too many requests'}}),
      );
      const toasts = await recordToasts(page);

      await page.goto('/settings/appearance');
      await expect.poll(() => reads.count).toBeGreaterThan(0);
      await page.waitForTimeout(1000);
      expect(await toasts()).toEqual([]);
      expect((await pushState(page)).subscribeCalls).toBe(0);
    });

    test('a failed registration does not read the settings again', async ({page}) => {
      await stubPush(page, {permission: 'granted'});
      const reads = await countSettingsReads(page, (route) => route.fulfill({json: settings()}));
      let registrations = 0;
      await page.route(`${API_URL}/notifications/subscriptions`, (route) => {
        registrations++;
        return route.fulfill({status: 500, json: {message: 'Internal server error'}});
      });

      await page.goto('/settings/appearance');
      await expect.poll(() => registrations).toBe(1);
      await expect.poll(async () => (await pushState(page)).subscribed).toBe(false);
      await page.waitForTimeout(1000);
      expect(reads.count).toBe(1);
      expect(registrations).toBe(1);
    });

    test('after opening while Tempo is unreachable, reads the settings only once Tempo confirms the session', async ({
      page,
    }) => {
      await stubPush(page, {permission: 'granted'});
      const reads = await countSettingsReads(page, (route) => route.fulfill({json: settings()}));
      await recordSubscriptionRequests(page);
      await page.goto('/settings/appearance');
      // The saved account lets Tempo open without a connection.
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem('wisp-offline-cache')))
        .not.toBeNull();
      await expect.poll(() => reads.count).toBe(1);

      let confirm = () => {};
      const confirmation = new Promise<void>((resolve) => (confirm = resolve));
      await page.route('**/accounts/me', async (route) => {
        await confirmation;
        return route.fulfill({json: account});
      });
      await mockJson(page, `${API_URL}/health`, {status: 'ok'});
      let unreachable = true;
      await page.route(`${API_URL}/**`, (route) =>
        unreachable ? route.abort('internetdisconnected') : route.fallback(),
      );
      await setPushOnLoad(page, {subscribed: false});
      reads.count = 0;
      await page.reload();
      await expect(page.getByRole('status').filter({hasText: /^Offline/})).toBeVisible();

      // Reconnecting probes Tempo, then asks it to confirm the session, which is held here.
      unreachable = false;
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(page.getByRole('status').filter({hasText: /^Offline/})).toBeHidden();
      await page.waitForTimeout(1000);
      expect(reads.count).toBe(0);

      confirm();
      await expect.poll(() => reads.count).toBe(1);
    });
  });
});
