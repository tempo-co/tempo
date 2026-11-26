import type {Page} from '@playwright/test';
import type {
  BankBalanceTrend,
  BankConnection,
  BankImportSummary,
  BankTransaction,
} from '@tempo/contracts';

import {API_URL} from '../fixtures';
import {fulfillJson, mockBankConnections} from './api-mocks';

/**
 * Answers what Accounts and an account page read, on top of `routeMockedBankApp`: the connections, the import list
 * (file import on), an account's transactions and the balance trend. Each answer can change between reloads.
 */
export async function mockAccountsApi(
  page: Page,
  data: () => {
    connections: BankConnection[];
    imports?: BankImportSummary[];
    transactions?: BankTransaction[];
    trend?: BankBalanceTrend;
  },
) {
  await mockBankConnections(page, () => data().connections);
  await page.route(
    (url) => url.origin === API_URL && url.pathname === '/bank-imports',
    (route) => {
      const {imports} = data();
      return imports
        ? fulfillJson(route, {imports, mapper: false})
        : fulfillJson(route, {statusCode: 404, message: 'Not Found'}, 404);
    },
  );
  await page.route(
    (url) => url.origin === API_URL && url.pathname === '/bank-transactions',
    (route) => {
      const transactions = data().transactions ?? [];
      const url = new URL(route.request().url());
      const size = Number(url.searchParams.get('pagination[pageSize]') ?? 20);
      const ordered =
        url.searchParams.get('sort[order]') === 'ASC' ? [...transactions].reverse() : transactions;
      return fulfillJson(route, {transactions: ordered.slice(0, size), total: transactions.length});
    },
  );
  await page.route(
    (url) => url.origin === API_URL && url.pathname === '/bank-transactions/balance-trend',
    (route) =>
      fulfillJson(route, data().trend ?? {baseCurrency: 'EUR', interval: 'month', periods: []}),
  );
}

/** A month-end balance trend over the last `months` months in which each account moves by its own step. */
export function balanceTrend(
  accounts: {id: string; start: number; step: number}[],
  months = 12,
): BankBalanceTrend {
  const today = new Date();
  const periods = Array.from({length: months}, (_, index) => {
    const end = new Date(today.getFullYear(), today.getMonth() - months + 2 + index, 0);
    const last = index === months - 1;
    const day = last ? today : end;
    const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    return {
      start: `${date.slice(0, 7)}-01`,
      end: date,
      complete: !last,
      total: null,
      accounts: accounts.map(({id, start, step}) => ({
        id,
        balance: (start + step * index).toFixed(2),
      })),
    };
  });
  return {baseCurrency: 'EUR', interval: 'month', periods};
}
