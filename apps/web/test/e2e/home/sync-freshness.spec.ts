import {QueryObserver} from '@tanstack/react-query';
import type {BankConnection} from '@tempo/contracts';

import {dashboardQueryKeys} from '../../../src/features/banking/api/aggregate-query-keys';
import {bankQueryKeys} from '../../../src/features/banking/api/query-keys';
import {
  HOME_CONNECTION,
  HOME_REVIEW_COUNTS,
  USUAL_SPENDING,
  homeHistory,
  mockSyntheticHome,
} from '../../data/home-history.data';
import {expect, test} from '../../fixtures';
import {fulfillJson} from '../../utils/api-mocks';
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

test.use({storageState: {cookies: [], origins: []}, timezoneId: 'Europe/Amsterdam'});

test('Home refreshes its history and the review badge when a polled sync completes', async ({
  page,
  homePage,
}) => {
  let current: BankConnection = {...HOME_CONNECTION, syncStatus: 'QUEUED'};
  let completed = false;
  let connectionReads = 0;
  const reads = {flow: 0, review: 0};
  const before = homeHistory();
  // The sync brings in October's last €400 of spending.
  const after = homeHistory({
    spending: (month) =>
      month === '2026-11'
        ? {HOUSING_AND_UTILITIES: 1200}
        : {
            ...USUAL_SPENDING,
            ...(month === '2026-10' ? {SHOPPING: 600} : {}),
            ...(month === '2026-03' ? {TRAVEL: 1500} : {}),
          },
  });
  await mockSyntheticHome(page, {
    history: before,
    clock: 'installed',
    connections: () => {
      connectionReads++;
      return [current];
    },
  });
  await page.route('**/bank-transactions/cash-flow?**', (route) => {
    reads.flow++;
    return fulfillJson(route, (completed ? after : before).flow);
  });
  await page.route('**/bank-transactions/review-counts', (route) => {
    reads.review++;
    return fulfillJson(route, {
      ...HOME_REVIEW_COUNTS,
      needsReview: completed ? 3 : 2,
      needsAttention: completed ? 4 : 3,
    });
  });
  await page.goto('/');
  // The span's kept figure includes October's.
  const kept = homePage.whereYouStand
    .getByRole('region', {name: 'This span'})
    .getByText('Kept', {exact: true})
    .locator('..');
  await expect(kept).toHaveText('Kept+€9,300');
  await expect(page.getByRole('link', {name: 'Transactions, 3 to review'}).first()).toBeVisible();
  expect(reads).toEqual({flow: 1, review: 1});

  // Let timers continue while responses and derived-data invalidation finish. A request count
  // alone does not mean the query has settled and re-armed its polling timer.
  test.setTimeout(40_000);
  await page.clock.resume();
  current = {...current, syncStatus: 'RUNNING'};
  await expect.poll(() => connectionReads, {timeout: 15_000}).toBe(2);
  completed = true;
  current = {...current, syncStatus: 'SUCCEEDED', lastSyncedAt: '2026-11-05T12:00:30.000Z'};
  await expect.poll(() => connectionReads, {timeout: 15_000}).toBe(3);
  await expect(kept).toHaveText('Kept+€8,900');
  await expect(page.getByRole('link', {name: 'Transactions, 4 to review'}).first()).toBeVisible();
  await expect(page).toHaveURL('/');
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
  dashboardQueryKeys.breakdown('year', 'category', '2007-01-01', '2026-10-01', '2026-10-01'),
  dashboardQueryKeys.reviewCounts,
  bankQueryKeys.transactions({pageIndex: 0, pageSize: 10}, {cashFlows: ['SPENDING']}, undefined),
  bankQueryKeys.transaction('example-transaction'),
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
