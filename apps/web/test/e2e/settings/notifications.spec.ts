import type {Page, Request} from '@playwright/test';
import type {NotificationSettings} from '@tempo/contracts';

import {API_URL, expect, test} from '../../fixtures';
import {EMPTY_REVIEW_COUNTS, mockJson} from '../../utils/api-mocks';

// A throwaway VAPID public key; the browser's push service is replaced below.
const PUBLIC_KEY =
  'BE9REd2wuwnXNoYqo5snAjISJAwtTxv9Y3vH7d8WU9xUcmm7iivjJ6eypA8yRl59qfLWC9mWQIg-cgrpoaiq2zA';
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/example-device';
const KEYS = {p256dh: 'BExampleP256dhKey', auth: 'ExampleAuthKey'};
const account = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Alex Example',
  email: 'alex@example.com',
  isEmailVerified: true,
};
const settings = (overrides: Partial<NotificationSettings> = {}): NotificationSettings => ({
  publicKey: PUBLIC_KEY,
  preferences: {bankConnections: true, recurringBills: true},
  ...overrides,
});

type PushStub = {
  permission: NotificationPermission;
  /** What the next permission prompt answers. */
  answer: NotificationPermission;
  permissionRequests: number;
  subscribed: boolean;
  subscribeKeyLength: number | null;
  badges: number[];
};

/**
 * Replaces the browser's notification permission, push manager and app badge, so the flow runs the same in every
 * browser without a push service. The state lives on `window.__push`.
 */
async function stubPush(page: Page, initial: Partial<PushStub> = {}) {
  await page.addInitScript(
    ({initial, endpoint, keys}) => {
      const state: PushStub = {
        permission: 'default',
        answer: 'granted',
        permissionRequests: 0,
        subscribed: false,
        subscribeKeyLength: null,
        badges: [],
        ...initial,
      };
      Object.assign(window, {__push: state});
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
        subscribe: ({applicationServerKey}: {applicationServerKey: Uint8Array}) => {
          state.subscribeKeyLength = applicationServerKey.length;
          state.subscribed = true;
          return Promise.resolve(subscription);
        },
      };
      const registration = {pushManager};
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: {
          ready: Promise.resolve(registration),
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

const deviceRow = (page: Page) =>
  page.getByRole('region', {name: 'Notifications'}).getByRole('status');

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

      test('explains what to do instead of offering the button', async ({page}) => {
        await stubPush(page);
        await mockJson(page, `${API_URL}/notifications`, settings());

        await page.goto('/settings/account');

        await expect(deviceRow(page)).toHaveText(status);
        await expect(page.getByRole('button', {name: 'Allow notifications'})).toHaveCount(0);
      });
    });
  }

  test('saves each alert choice and puts it back when the save fails', async ({page}) => {
    await stubPush(page);
    await mockJson(page, `${API_URL}/notifications`, settings());
    const saves: unknown[] = [];
    let fail = false;
    await page.route(`${API_URL}/notifications/preferences`, async (route) => {
      saves.push(route.request().postDataJSON());
      if (fail) return route.fulfill({status: 500, json: {message: 'Internal server error'}});
      return route.fulfill({
        json: settings({preferences: {bankConnections: true, recurringBills: false}}),
      });
    });

    await page.goto('/settings/account');
    const alerts = page.getByRole('region', {name: 'Alerts'});
    const bills = alerts.getByRole('checkbox', {name: /Bills/});
    const banks = alerts.getByRole('checkbox', {name: /Bank connections/});
    await expect(bills).toBeChecked();
    await expect(banks).toBeChecked();

    await bills.click();
    await expect(bills).not.toBeChecked();
    expect(saves).toEqual([{recurringBills: false}]);

    fail = true;
    await banks.click();
    await expect(page.getByText('The alert setting could not be saved.')).toBeVisible();
    await expect(banks).toBeChecked();
    expect(saves[saves.length - 1]).toEqual({bankConnections: false});
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
  });
});
