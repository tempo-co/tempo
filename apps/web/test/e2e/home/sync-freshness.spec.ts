import {QueryObserver} from '@tanstack/react-query';

import {bankQueryKeys} from '../../../src/features/banking/api/query-keys';
import type {BankConnection} from '../../../src/features/banking/types/bank-connection';
import {dashboardQueryKeys} from '../../../src/features/dashboard/api/query-keys';
import {VERIFIED_USER_AUTH_FILE} from '../../constants/auth.constants';
import {SEEDED_TRANSACTION_YEAR_NOW} from '../../constants/seed.constants';
import {septemberSummary} from '../../data/home-summary.data';
import {expect, test} from '../../fixtures';
import {fulfillJson, mockBankConnections} from '../../utils/api-mocks';
import {createHookHarness} from '../../utils/hook-harness';

const connection: BankConnection = {
  id: '00000000-0000-4000-8000-000000000001',
  provider: 'ENABLE_BANKING',
  aspspName: 'Example Bank',
  aspspCountry: 'NL',
  status: 'AUTHORIZED',
  consentValidUntil: '2027-01-01T00:00:00Z',
  lastSyncedAt: '2026-09-01T00:00:00Z',
  lastSyncError: null,
  nextSyncAt: null,
  syncStatus: 'QUEUED',
  baseCurrency: 'EUR',
  bankAccounts: [],
};

test.use({storageState: VERIFIED_USER_AUTH_FILE});

test('Home refreshes spending, review counts and recent transactions when a polled sync completes', async ({
  page,
}) => {
  let current = connection;
  let completed = false;
  let connectionReads = 0;
  const reads = {summary: 0, review: 0, recent: 0};
  await page.clock.install({time: SEEDED_TRANSACTION_YEAR_NOW});
  await mockBankConnections(page, () => {
    connectionReads++;
    return [current];
  });
  await page.route('**/bank-transactions/summary**', (route) => {
    reads.summary++;
    return fulfillJson(route, {
      ...septemberSummary,
      totals: {...septemberSummary.totals, spending: completed ? '1400.00' : '1200.00'},
    });
  });
  await page.route('**/bank-transactions/review-counts', (route) => {
    reads.review++;
    return fulfillJson(route, {
      needsReview: completed ? 2 : 1,
      categorizationFailed: 0,
      categorizing: 0,
      unknownDirection: 0,
      missingBaseAmount: 0,
    });
  });
  await page.route('**/bank-transactions?**', (route) => {
    reads.recent++;
    return fulfillJson(route, {
      transactions: completed
        ? [
            {
              id: '00000000-0000-4000-8000-000000000002',
              bookingDate: '2026-09-30',
              amount: '-200.00',
              currency: 'EUR',
              displayDescription: 'Example synced shop',
              category: 'OTHER',
              categoryStatus: 'COMPLETED',
            },
          ]
        : [],
      total: completed ? 1 : 0,
    });
  });
  await page.goto('/?month=2026-09');
  const spending = page.getByTestId('spending-summary');
  const attention = page.getByRole('region', {name: 'Needs attention', exact: true});
  const recent = page.getByRole('region', {name: 'Latest in September 2026'});
  await expect(spending.getByRole('link', {name: '€1,200.00', exact: true})).toBeVisible();
  await expect(attention).toContainText('1 transaction · all months');
  await expect(recent).toContainText('No transactions this month.');
  expect(reads).toEqual({summary: 1, review: 1, recent: 1});

  // Let timers continue while responses and derived-data invalidation finish. A request count
  // alone does not mean the query has settled and re-armed its polling timer.
  test.setTimeout(40_000);
  await page.clock.resume();
  current = {...connection, syncStatus: 'RUNNING'};
  await expect.poll(() => connectionReads, {timeout: 15_000}).toBe(2);
  completed = true;
  current = {...connection, syncStatus: 'SUCCEEDED', lastSyncedAt: '2026-10-01T00:00:00Z'};
  await expect.poll(() => connectionReads, {timeout: 15_000}).toBe(3);
  await expect(spending.getByRole('link', {name: '€1,400.00', exact: true})).toBeVisible();
  await expect(attention).toContainText('2 transactions · all months');
  await expect(recent).toContainText('Example synced shop');
  await expect(page).toHaveURL(/\?month=2026-09$/);
});

// The backend has no public sync fixture endpoint. Load the real hook with only HTTP replaced;
// real TanStack Query caches/observers exercise inactive roots without changing the shared stack.
function syncHarness() {
  let response: BankConnection[] = [];
  let failure = false;
  const {client, renderHook} = createHookHarness({
    '@/utils/api': {
      api: {
        get: () =>
          failure
            ? Promise.reject(new Error('Synthetic connection failure'))
            : Promise.resolve(response),
      },
    },
  });
  renderHook(
    'src/features/banking/api/use-get-all-bank-connections.ts',
    'useGetAllBankConnections',
  );
  const queryFn = client.getQueryCache().find({queryKey: bankQueryKeys.connections})!.options
    .queryFn;
  return {
    client,
    poll: async (next: BankConnection[], reject = false) => {
      response = next;
      failure = reject;
      return client.fetchQuery({queryKey: bankQueryKeys.connections, queryFn, staleTime: 0});
    },
  };
}

const cachedKeys = [
  dashboardQueryKeys.summary('2026-09', '2026-10-01'),
  dashboardQueryKeys.summary('2026-08', '2026-10-01'),
  dashboardQueryKeys.reviewCounts,
  bankQueryKeys.transactions({pageIndex: 0, pageSize: 10}, {cashFlows: ['SPENDING']}, undefined),
  bankQueryKeys.transaction('example-transaction'),
  bankQueryKeys.connectionTransactions(connection.id, connection.lastSyncedAt),
];

for (const [name, before, after] of [
  ['queued to running', connection, {...connection, syncStatus: 'RUNNING'}],
  [
    'partial ingestion',
    {...connection, syncStatus: 'RUNNING'},
    {...connection, syncStatus: 'PARTIAL'},
  ],
  [
    'failed ingestion',
    {...connection, syncStatus: 'RUNNING'},
    {...connection, syncStatus: 'FAILED'},
  ],
  [
    'missed polling cycle',
    {...connection, syncStatus: 'SUCCEEDED'},
    {
      ...connection,
      syncStatus: 'SUCCEEDED',
      lastSyncedAt: '2026-10-01T00:00:00Z',
    },
  ],
] satisfies [string, BankConnection, BankConnection][]) {
  test(`sync ${name} refreshes active data and invalidates every cached root`, async () => {
    const {client, poll} = syncHarness();
    await poll([before]);
    for (const key of cachedKeys) client.setQueryData(key, {revision: 0});
    const unrelated = ['example-unrelated'];
    client.setQueryData(unrelated, {revision: 0});
    let reads = 0;
    // Reads counts HTTP-boundary calls, not a query parameter.
    // eslint-disable-next-line @tanstack/query/exhaustive-deps
    const observer = new QueryObserver(client, {
      queryKey: dashboardQueryKeys.reviewCounts,
      queryFn: () => Promise.resolve({revision: ++reads}),
    });
    const unsubscribe = observer.subscribe(() => {});
    try {
      await poll([after]);
      expect(client.getQueryData(dashboardQueryKeys.reviewCounts)).toEqual({revision: 1});
      for (const key of cachedKeys.filter((key) => key !== dashboardQueryKeys.reviewCounts))
        expect(client.getQueryState(key)?.isInvalidated).toBe(true);
      expect(client.getQueryState(unrelated)?.isInvalidated).toBe(false);
    } finally {
      unsubscribe();
      client.clear();
    }
  });
}

test('initial reads, unchanged polls and unrelated metadata leave caches fresh', async () => {
  const {client, poll} = syncHarness();
  for (const key of cachedKeys) client.setQueryData(key, {revision: 0});
  try {
    await poll([connection]);
    await poll([connection]);
    await poll([
      {...connection, nextSyncAt: '2026-10-02T00:00:00Z', aspspName: 'Example renamed bank'},
    ]);
    await poll([{...connection, id: 'example-new-connection'}]);
    await expect(poll([connection], true)).rejects.toThrow('Synthetic connection failure');
    for (const key of cachedKeys) expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  } finally {
    client.clear();
  }
});
