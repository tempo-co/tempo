import {expect, test} from '../../fixtures';

// Push delivery is driven through Chromium DevTools, and the headless shell denies notifications:
// full Chromium in headless mode shows them. The WebKit project skips this file.
test.use({channel: 'chromium', storageState: {cookies: [], origins: []}});

test.beforeEach(async ({page}) => {
  await page.route('**/accounts/me', (route) =>
    route.fulfill({
      json: {
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Alex Example',
        email: 'alex@example.com',
        isEmailVerified: true,
      },
    }),
  );
});

/** The parts of a service worker's global scope these specs use; the test build has no worker types. */
type WorkerScope = {
  registration: {
    getNotifications(filter?: {tag: string}): Promise<unknown[]>;
    showNotification(title: string, options: {tag: string; data: unknown}): Promise<void>;
  };
  dispatchEvent(event: Event): boolean;
  NotificationEvent: new (type: string, init: {notification: unknown}) => Event;
};

test.describe('Alerts from the service worker', () => {
  test('shows a pushed alert with the badge count and opens its screen when clicked', async ({
    page,
    context,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    await context.grantPermissions(['notifications'], {origin});
    await page.goto('/settings/account');
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await worker.evaluate(() => {
      const scope = self as unknown as {badges: number[]; navigator: Record<string, unknown>};
      scope.badges = [];
      Object.defineProperty(scope.navigator, 'setAppBadge', {
        configurable: true,
        value: (count: number) => Promise.resolve(void scope.badges.push(count)),
      });
    });

    const cdp = await context.newCDPSession(page);
    // The running worker that controls this page: the browser also lists other contexts' workers, and
    // attaching DevTools can restart it, which would drop a push sent in between.
    const {targetInfo} = await cdp.send('Target.getTargetInfo');
    const registered = new Promise<string>((resolve) =>
      cdp.on('ServiceWorker.workerVersionUpdated', ({versions}) => {
        const version = versions.find(
          ({controlledClients, runningStatus}) =>
            runningStatus === 'running' && controlledClients?.includes(targetInfo.targetId),
        );
        if (version) resolve(version.registrationId);
      }),
    );
    await cdp.send('ServiceWorker.enable');
    const registrationId = await registered;
    const series = 'a'.repeat(32);
    await cdp.send('ServiceWorker.deliverPushMessage', {
      origin,
      registrationId,
      data: JSON.stringify({
        title: 'Tempo',
        body: 'A bill is late',
        url: `${origin}/?recurring=open&series=${series}`,
        tag: `recurring-${series}`,
        badge: 4,
      }),
    });

    // Reading notifications while the worker is still showing this one can lose it in headless
    // Chromium, so wait for the badge the same push sets first.
    await expect
      .poll(() => worker.evaluate(() => (self as unknown as {badges: number[]}).badges))
      .toEqual([4]);
    const shown = await worker.evaluate(async () =>
      (await (self as unknown as WorkerScope).registration.getNotifications()).map(
        (notification) => {
          const {title, body, tag} = notification as Notification;
          const data: unknown = (notification as Notification).data;
          return {title, body, tag, data};
        },
      ),
    );
    expect(shown).toEqual([
      {
        title: 'Tempo',
        body: 'A bill is late',
        tag: `recurring-${series}`,
        data: {url: `${origin}/?recurring=open&series=${series}`},
      },
    ]);

    // A click on the notification: Tempo's open window goes to the alert's screen.
    await worker.evaluate(async () => {
      const scope = self as unknown as WorkerScope;
      const [notification] = await scope.registration.getNotifications();
      scope.dispatchEvent(new scope.NotificationEvent('notificationclick', {notification}));
    });
    await expect(page).toHaveURL(`${origin}/?recurring=open&series=${series}`);
  });

  test('opens only Tempo pages from a notification', async ({page, context, baseURL}) => {
    const origin = new URL(baseURL!).origin;
    await context.grantPermissions(['notifications'], {origin});
    await page.goto('/settings/account');
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));

    await worker.evaluate(async () => {
      const scope = self as unknown as WorkerScope;
      await scope.registration.showNotification('Tempo', {
        tag: 'elsewhere',
        data: {url: 'https://elsewhere.example.test/'},
      });
      const [notification] = await scope.registration.getNotifications({tag: 'elsewhere'});
      scope.dispatchEvent(new scope.NotificationEvent('notificationclick', {notification}));
    });

    await expect(page).toHaveURL(`${origin}/`);
  });
});
