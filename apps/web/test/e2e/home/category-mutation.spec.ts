import {InfiniteQueryObserver} from '@tanstack/react-query';

import {dashboardQueryKeys} from '../../../src/features/banking/api/aggregate-query-keys';
import {bankQueryKeys} from '../../../src/features/banking/api/query-keys';
import type {BankTransactionFilterParams} from '../../../src/features/banking/types/bank-transaction';
import {expect, test} from '../../fixtures';
import {createHookHarness} from '../../utils/hook-harness';

// The public API cannot seed FAILED/PROCESSING categorization or arbitrary cash-flow transitions.
// Exercise the real mutation hooks and QueryClient in an isolated React harness instead of changing
// shared seeded transactions. Only the HTTP boundary and toast presentation are replaced.
function mutationHarness(response: Record<string, unknown>, reject = false) {
  const request = () =>
    reject ? Promise.reject(new Error('Synthetic mutation failure')) : Promise.resolve(response);
  const {client, renderHook} = createHookHarness({
    '@/utils/api': {api: {patch: request, delete: request}, wasToasted: () => false},
    sonner: {
      toast: {loading: () => 'toast', success: () => undefined, error: () => undefined},
    },
  });
  const hook = <T>(filename: string, exportName: string) =>
    renderHook<T>(`src/features/banking/api/${filename}`, exportName);
  return {client, hook};
}

/** A Transactions list as its cache holds it: every page loaded so far. */
const pagesOf = (...pages: {transactions: unknown[]; total: number}[]) => ({
  pages,
  pageParams: pages.map((_, index) => index),
});

/** Keeps a list's query active, as the Transactions page does, answering every page fetch with `page()`. */
function observeList(
  client: ReturnType<typeof mutationHarness>['client'],
  key: readonly unknown[],
  page: () => {transactions: unknown[]; total: number},
) {
  // The key represents the server filter; the observer only answers fetches at the HTTP boundary.
  const observer = new InfiniteQueryObserver(client, {
    queryKey: key,
    queryFn: () => Promise.resolve(page()),
    initialPageParam: 0,
    getNextPageParam: () => undefined,
  });
  return observer.subscribe(() => {});
}

for (const filters of [
  {cashFlows: ['UNKNOWN']},
  {categoryStatuses: ['FAILED']},
  {categoryStatuses: ['CATEGORIZING']},
] satisfies BankTransactionFilterParams[]) {
  test(`category save refetches the ${JSON.stringify(filters)} drill`, async () => {
    const {client, hook} = mutationHarness({
      id: 'example-transaction',
      category: 'REFUND',
      categoryStatus: 'COMPLETED',
    });
    const key = bankQueryKeys.transactions(filters, undefined);
    let reads = 0;
    client.setQueryData(
      key,
      pagesOf({transactions: [{id: 'example-transaction', category: null}], total: 1}),
    );
    const unsubscribe = observeList(client, key, () => {
      reads++;
      return {transactions: [], total: 0};
    });
    try {
      const mutation = hook<{
        updateBankTransactionCategory: (input: {id: string; category: string}) => Promise<unknown>;
      }>('use-update-bank-transaction-category.ts', 'useUpdateBankTransactionCategory');
      await mutation.updateBankTransactionCategory({id: 'example-transaction', category: 'REFUND'});
      await expect
        .poll(() => client.getQueryData(key))
        .toEqual(pagesOf({transactions: [], total: 0}));
      expect(reads).toBe(1);
      expect(client.getQueryData(bankQueryKeys.transaction('example-transaction'))).toMatchObject({
        category: 'REFUND',
      });
    } finally {
      unsubscribe();
      client.clear();
    }
  });
}

test('category save refreshes a drill that did not previously contain the transaction', async () => {
  const updated = {id: 'example-transaction', category: 'OTHER', categoryStatus: 'COMPLETED'};
  const {client, hook} = mutationHarness(updated);
  const key = bankQueryKeys.transactions({cashFlows: ['UNKNOWN']}, undefined);
  client.setQueryData(key, pagesOf({transactions: [], total: 0}));
  // The synthetic response changes without changing the server filter key.
  const unsubscribe = observeList(client, key, () => ({transactions: [updated], total: 1}));
  try {
    const mutation = hook<{
      updateBankTransactionCategory: (input: {id: string; category: string}) => Promise<unknown>;
    }>('use-update-bank-transaction-category.ts', 'useUpdateBankTransactionCategory');
    await mutation.updateBankTransactionCategory({id: updated.id, category: updated.category});
    expect(client.getQueryData(key)).toEqual(pagesOf({transactions: [updated], total: 1}));
  } finally {
    unsubscribe();
    client.clear();
  }
});

// A correction can also change the owner's other rows from the same merchant on the server, so every list is
// refetched after the immediate update.
test('category-only and source-only lists update immediately and are refetched', async () => {
  const updated = {id: 'example-transaction', category: 'OTHER', categorySource: 'MANUAL'};
  const {client, hook} = mutationHarness(updated);
  const removedKey = bankQueryKeys.transactions({categories: ['FOOD_AND_DRINK']}, undefined);
  const retainedKey = bankQueryKeys.transactions({categorySources: ['MANUAL']}, undefined);
  const original = {id: updated.id, category: 'FOOD_AND_DRINK', categorySource: 'MANUAL'};
  const other = {id: 'example-other-transaction', category: 'FOOD_AND_DRINK'};
  // The corrected row sits on the second page "Load more" fetched; every page carries the list's total.
  for (const key of [removedKey, retainedKey])
    client.setQueryData(
      key,
      pagesOf({transactions: [other], total: 2}, {transactions: [original], total: 2}),
    );
  try {
    const mutation = hook<{
      updateBankTransactionCategory: (input: {id: string; category: string}) => Promise<unknown>;
    }>('use-update-bank-transaction-category.ts', 'useUpdateBankTransactionCategory');
    await mutation.updateBankTransactionCategory({id: updated.id, category: 'OTHER'});
    expect(client.getQueryData(removedKey)).toEqual(
      pagesOf({transactions: [other], total: 1}, {transactions: [], total: 1}),
    );
    expect(client.getQueryData(retainedKey)).toEqual(
      pagesOf({transactions: [other], total: 2}, {transactions: [updated], total: 2}),
    );
    expect(client.getQueryState(removedKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(retainedKey)?.isInvalidated).toBe(true);
  } finally {
    client.clear();
  }
});

for (const [filename, exportName, method, input] of [
  [
    'use-update-bank-transaction-category.ts',
    'useUpdateBankTransactionCategory',
    'updateBankTransactionCategory',
    {id: 'example-transaction', category: 'OTHER'},
  ],
  [
    'use-update-bank-transaction-own-transfer.ts',
    'useUpdateBankTransactionOwnTransfer',
    'updateBankTransactionOwnTransfer',
    {id: 'example-transaction', override: 'MARKED'},
  ],
  [
    'use-delete-bank-connection.ts',
    'useDeleteBankConnection',
    'deleteBankConnection',
    'example-connection',
  ],
] as const) {
  test(`${method} invalidates every cached Home history and review counts`, async () => {
    const {client, hook} = mutationHarness({id: 'example-transaction', category: 'OTHER'});
    const keys = [
      dashboardQueryKeys.breakdown('year', 'category', '2007-01-01', '2026-10-04', '2026-10-04'),
      dashboardQueryKeys.breakdown('month', 'source', '2007-01-01', '2026-10-04', '2026-10-04'),
      dashboardQueryKeys.reviewCounts,
    ];
    keys.forEach((key) => client.setQueryData(key, {cached: true}));
    try {
      const mutation = hook<Record<string, (input: unknown) => Promise<unknown>>>(
        filename,
        exportName,
      );
      await mutation[method](input);
      for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    } finally {
      client.clear();
    }
  });
  test(`${method} leaves dashboard caches fresh when the request fails`, async () => {
    const {client, hook} = mutationHarness({}, true);
    const key = dashboardQueryKeys.reviewCounts;
    client.setQueryData(key, {cached: true});
    try {
      const mutation = hook<Record<string, (input: unknown) => Promise<unknown>>>(
        filename,
        exportName,
      );
      await expect(mutation[method](input)).rejects.toThrow('Synthetic mutation failure');
      expect(client.getQueryData(key)).toEqual({cached: true});
      expect(client.getQueryState(key)?.isInvalidated).toBe(false);
    } finally {
      client.clear();
    }
  });
}
