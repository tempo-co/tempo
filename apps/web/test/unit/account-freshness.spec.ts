// A pure module's contract: no page, so this uses Playwright's own `test` rather than the app fixtures.
import {expect, test} from '@playwright/test';
import type {BankConnection, BankImportSummary} from '@tempo/contracts';

import {accountFreshness} from '../../src/features/accounts/utils/account-freshness';
import {MOCK_CONNECTION} from '../data/bank-connection.data';

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
/** Thursday 26 November 2026, mid-afternoon local time. */
const NOW = new Date(2026, 10, 26, 15, 0).getTime();
const account = MOCK_CONNECTION.bankAccounts[0];
const files: BankConnection = {
  ...MOCK_CONNECTION,
  provider: 'file',
  aspspName: 'Imported files',
  consentValidUntil: null,
  syncStatus: 'IDLE',
};

function anImport(overrides: Partial<BankImportSummary>): BankImportSummary {
  return {
    id: crypto.randomUUID(),
    bankId: null,
    format: 'camt053',
    layout: null,
    filesCount: 1,
    rowsParsed: 10,
    rowsAdded: 10,
    rowsAlreadyPresent: 0,
    rowsMatchedByReference: 0,
    rowsMatchedByBalance: 0,
    rowsMatchedByDate: 0,
    rowsDoubtful: 0,
    rowsNotInBank: 0,
    rowsRemovedBySync: 0,
    dateFrom: '2026-10-01',
    dateTo: '2026-11-20',
    accounts: [{id: account.id, name: null, currency: 'EUR', created: false}],
    accountsWithoutBalance: [],
    statementGaps: [],
    undoneAt: null,
    createdAt: new Date(NOW - HOUR).toISOString(),
    ...overrides,
  };
}

const freshness = (connection: BankConnection, imports?: BankImportSummary[]) =>
  accountFreshness({connection, accountId: account.id, imports, now: NOW});

test('a file account runs up to its newest import that is not undone, and says when it was imported', () => {
  expect(
    freshness(files, [
      anImport({dateTo: '2026-11-20'}),
      anImport({dateTo: '2026-11-24', undoneAt: new Date(NOW - HOUR).toISOString()}),
      anImport({
        dateTo: '2026-11-10',
        createdAt: new Date(NOW - 3 * DAY).toISOString(),
        accounts: [{id: 'another', name: null, currency: 'EUR', created: false}],
      }),
    ]),
  ).toEqual({tone: 'ok', label: 'File up to 20 Nov', detail: 'imported today', action: null});
  expect(
    freshness(files, [
      anImport({dateTo: '2026-11-18', createdAt: new Date(NOW - DAY).toISOString()}),
    ]),
  ).toMatchObject({label: 'File up to 18 Nov', detail: 'imported yesterday'});
  expect(
    freshness(files, [
      anImport({dateTo: '2026-11-02', createdAt: new Date(2026, 10, 3, 9).toISOString()}),
    ]),
  ).toMatchObject({label: 'File up to 2 Nov', detail: 'imported 3 Nov'});
});

test('a file older than 35 days turns amber and offers a newer one', () => {
  // 21 October is 36 days before 26 November; 22 October is 35.
  expect(freshness(files, [anImport({dateTo: '2026-10-22'})])).toMatchObject({tone: 'ok'});
  expect(freshness(files, [anImport({dateTo: '2026-10-21'})])).toEqual({
    tone: 'warning',
    label: 'File up to 21 Oct',
    detail: '36 days ago',
    action: 'import',
  });
  expect(freshness(files, [anImport({dateTo: '2025-12-31'})])).toMatchObject({
    label: 'File up to 31 Dec 2025',
    detail: '330 days ago',
  });
});

test('a file account with no import says so and offers one; without the import list it names its source only', () => {
  expect(freshness(files, [])).toEqual({
    tone: 'quiet',
    label: 'No statement file yet',
    action: 'import',
  });
  expect(freshness(files, undefined)).toEqual({
    tone: 'quiet',
    label: 'From statement files',
    action: null,
  });
});

test('a synced account says how long ago its last successful sync was', () => {
  const synced = (ago: number) =>
    freshness({...MOCK_CONNECTION, lastSuccessfulSyncAt: new Date(NOW - ago).toISOString()});
  expect(synced(20_000)).toEqual({tone: 'ok', label: 'Synced just now', action: null});
  expect(synced(5 * 60_000)).toMatchObject({tone: 'ok', label: 'Synced 5 min ago'});
  expect(synced(2 * HOUR + 59 * 60_000)).toMatchObject({tone: 'ok', label: 'Synced 2 h ago'});
  // Over a day without one is worth noticing, though nothing is broken yet.
  expect(synced(3 * DAY)).toEqual({tone: 'warning', label: 'Synced 3 days ago', action: null});
  expect(freshness({...MOCK_CONNECTION, lastSuccessfulSyncAt: null})).toEqual({
    tone: 'quiet',
    label: 'Not synced yet',
    action: null,
  });
  expect(
    freshness({...MOCK_CONNECTION, lastSuccessfulSyncAt: null, syncStatus: 'RUNNING'}),
  ).toEqual({tone: 'quiet', label: 'Syncing…', action: null});
});

test('a connection in trouble shows its reason, with Reconnect when reconnecting fixes it', () => {
  expect(
    freshness({
      ...MOCK_CONNECTION,
      status: 'EXPIRED',
      lastSuccessfulSyncAt: '2026-11-12T10:00:00.000Z',
    }),
  ).toEqual({
    tone: 'warning',
    label: 'Access expired',
    detail: 'no updates since 12 Nov',
    action: 'reconnect',
  });
  expect(freshness({...MOCK_CONNECTION, consentValidUntil: null})).toEqual({
    tone: 'warning',
    label: 'Access expired',
    detail: 'automatic sync has stopped',
    action: 'reconnect',
  });
  expect(freshness({...MOCK_CONNECTION, status: 'PENDING_AUTHORIZATION'})).toEqual({
    tone: 'warning',
    label: 'Not connected',
    detail: 'the bank did not finish authorizing',
    action: 'reconnect',
  });
  // A failed sync retries on its own, so it has nothing to press.
  expect(
    freshness({
      ...MOCK_CONNECTION,
      syncStatus: 'FAILED',
      lastSuccessfulSyncAt: '2026-11-19T10:00:00.000Z',
      lastSyncError: 'Synthetic bank refresh failed.',
    }),
  ).toEqual({
    tone: 'warning',
    label: 'Sync failed',
    detail: 'no updates since 19 Nov · retries on its own',
    action: null,
  });
});

test('access that ends within a week asks to reconnect before it stops', () => {
  const ends = new Date(Date.now() + 3 * DAY - HOUR).toISOString();
  expect(
    accountFreshness({
      connection: {
        ...MOCK_CONNECTION,
        consentValidUntil: ends,
        lastSuccessfulSyncAt: new Date().toISOString(),
      },
      accountId: account.id,
      now: Date.now(),
    }),
  ).toEqual({
    tone: 'warning',
    label: 'Access ends in 3 days',
    detail: 'reconnect to keep syncing',
    action: 'reconnect',
    soon: true,
  });
});
