// A pure module's contract: no page, so this uses Playwright's own `test` rather than the app fixtures.
import {expect, test} from '@playwright/test';
import type {BankConnection} from '@tempo/contracts';

import {awaitingFirstFetch, withData} from '../../src/features/home/utils/first-fetch';
import {MOCK_CONNECTION} from '../data/bank-connection.data';
import {importedFiles} from '../data/bank-import.data';

const connected = (fields: Partial<BankConnection>): BankConnection => ({
  ...MOCK_CONNECTION,
  lastSyncedAt: null,
  syncStatus: 'QUEUED',
  ...fields,
});
const SYNCED = {syncStatus: 'SUCCEEDED', lastSyncedAt: '2026-11-12T09:00:00Z'} as const;

test('Home waits while a bank is on its first fetch and no transaction is in, and shows itself otherwise', () => {
  for (const syncStatus of ['IDLE', 'QUEUED', 'RUNNING', 'RATE_LIMITED'] as const)
    expect(awaitingFirstFetch([connected({syncStatus})], false)).toBe(true);
  // A bank that synced nothing does not hold up a second one on its first fetch.
  expect(awaitingFirstFetch([connected({id: 'first', ...SYNCED}), connected({})], false)).toBe(
    true,
  );

  expect(awaitingFirstFetch([], false)).toBe(false);
  expect(awaitingFirstFetch([connected(SYNCED)], false)).toBe(false);
  // A bank that synced once shows Home while it fetches again.
  expect(
    awaitingFirstFetch(
      [connected({syncStatus: 'RUNNING', lastSyncedAt: SYNCED.lastSyncedAt})],
      false,
    ),
  ).toBe(false);
  for (const syncStatus of ['FAILED', 'PARTIAL', 'EXPIRED'] as const)
    expect(awaitingFirstFetch([connected({syncStatus})], false)).toBe(false);
  // Transactions already in, from a file or put into the bank's account by one, show Home; so does not knowing yet.
  expect(awaitingFirstFetch([connected({})], true)).toBe(false);
  expect(awaitingFirstFetch([connected({})], undefined)).toBe(false);
});

test('imported files whose imports were all undone hold nothing, and Home is empty without a bank', () => {
  expect(withData([importedFiles([])])).toEqual([]);
  expect(withData([importedFiles(MOCK_CONNECTION.bankAccounts)])).toHaveLength(1);
  expect(withData([connected({}), importedFiles([])])).toHaveLength(1);
});
