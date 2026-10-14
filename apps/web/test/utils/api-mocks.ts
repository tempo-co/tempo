import {Page, Route} from '@playwright/test';

import type {BankConnection} from '../../src/features/banking/types/bank-connection';

export function fulfillJson(route: Route, body: unknown, status = 200) {
  return route.fulfill({status, contentType: 'application/json', body: JSON.stringify(body)});
}

/** Synthetic monthly totals for specs that mock Home without a real session. */
export const syntheticCashFlow = {
  baseCurrency: 'EUR',
  interval: 'month',
  periods: ['2026-07', '2026-08', '2026-09'].map((month, index) => ({
    start: `${month}-01`,
    end: `${month}-${month === '2026-09' ? '30' : '31'}`,
    complete: true,
    spending: `${1100 + index * 50}.00`,
    income: '2500.00',
    net: `${1400 - index * 50}.00`,
  })),
};

/** Serves {@link syntheticCashFlow} for every interval, so the card never reaches the real API. */
export function mockCashFlow(page: Page) {
  return page.route('**/bank-transactions/cash-flow**', (route) => {
    const interval = new URL(route.request().url()).searchParams.get('interval');
    return fulfillJson(route, {...syntheticCashFlow, interval});
  });
}

/** Synthetic month-end balances for specs that mock Home without a real session. */
const syntheticBalanceTrend = {
  baseCurrency: 'EUR',
  interval: 'month',
  accounts: [{id: '00000000-0000-4000-8000-000000000001', since: '2026-07-01'}],
  periods: ['2026-07', '2026-08', '2026-09'].map((month, index) => ({
    start: `${month}-01`,
    end: `${month}-${month === '2026-09' ? '30' : '31'}`,
    complete: true,
    total: `${4000 + index * 250}.00`,
    accounts: [{id: '00000000-0000-4000-8000-000000000001', balance: `${4000 + index * 250}.00`}],
  })),
};

/** Serves {@link syntheticBalanceTrend} for every interval, so the card never reaches the real API. */
export function mockBalanceTrend(page: Page) {
  return page.route('**/bank-transactions/balance-trend**', (route) => {
    const interval = new URL(route.request().url()).searchParams.get('interval');
    return fulfillJson(route, {...syntheticBalanceTrend, interval});
  });
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
