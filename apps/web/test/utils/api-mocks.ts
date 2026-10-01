import {Page, Route} from '@playwright/test';

import type {BankConnection} from '../../src/features/banking/types/bank-connection';

export function fulfillJson(route: Route, body: unknown, status = 200) {
  return route.fulfill({status, contentType: 'application/json', body: JSON.stringify(body)});
}

/** Answers every request to `url` with the same JSON response. */
export function mockJson(page: Page, url: string, body: unknown, status = 200) {
  return page.route(url, (route) => fulfillJson(route, body, status));
}

/**
 * Intercepts the API's `GET /bank-connections` request. Page navigations to `/bank-connections`
 * share the URL pattern, so they are passed through.
 */
export function routeBankConnectionsApi(page: Page, handler: (route: Route) => Promise<void>) {
  return page.route('**/bank-connections', async (route) => {
    if (route.request().resourceType() === 'document') {
      await route.continue();
      return;
    }
    await handler(route);
  });
}

/** Serves fixed connections, or connections computed per request (for example to count polls). */
export function mockBankConnections(
  page: Page,
  connections: BankConnection[] | (() => BankConnection[]),
) {
  return routeBankConnectionsApi(page, (route) =>
    fulfillJson(route, typeof connections === 'function' ? connections() : connections),
  );
}

/** Serves the seeded connections after `transform` changes them. */
export function transformBankConnections(
  page: Page,
  transform: (connections: BankConnection[]) => unknown,
) {
  return routeBankConnectionsApi(page, async (route) => {
    const response = await route.fetch();
    const connections = (await response.json()) as BankConnection[];
    await route.fulfill({response, json: transform(connections)});
  });
}
