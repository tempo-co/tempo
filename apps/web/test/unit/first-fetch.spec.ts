// A pure module's contract: no page, so this uses Playwright's own `test` rather than the app fixtures.
import {expect, test} from '@playwright/test';
import type {BankConnection} from '@tempo/contracts';

import {awaitingFirstFetch} from '../../src/features/home/utils/first-fetch';
import {MOCK_CONNECTION} from '../data/bank-connection.data';
import {importedFiles} from '../data/bank-import.data';

const connected = (fields: Partial<BankConnection>): BankConnection => ({
  ...MOCK_CONNECTION,
  lastSyncedAt: null,
  syncStatus: 'QUEUED',
  ...fields,
});

test('Home waits while every bank is on its first fetch, and shows itself once one has synced, failed or files are in', () => {
  for (const syncStatus of ['IDLE', 'QUEUED', 'RUNNING'] as const)
    expect(awaitingFirstFetch([connected({syncStatus})])).toBe(true);
  expect(
    awaitingFirstFetch([connected({}), connected({id: 'second', syncStatus: 'RUNNING'})]),
  ).toBe(true);

  expect(awaitingFirstFetch([])).toBe(false);
  expect(
    awaitingFirstFetch([
      connected({syncStatus: 'SUCCEEDED', lastSyncedAt: '2026-11-12T09:00:00Z'}),
    ]),
  ).toBe(false);
  // A bank that synced once shows Home while it fetches again.
  expect(
    awaitingFirstFetch([connected({syncStatus: 'RUNNING', lastSyncedAt: '2026-11-12T09:00:00Z'})]),
  ).toBe(false);
  for (const syncStatus of ['FAILED', 'PARTIAL', 'RATE_LIMITED', 'EXPIRED'] as const)
    expect(awaitingFirstFetch([connected({syncStatus})])).toBe(false);
  expect(awaitingFirstFetch([connected({}), importedFiles([])])).toBe(false);
});
