import type {BankConnection, BankSyncStatus} from '@tempo/contracts';

import {isFileConnection} from '@/features/banking/utils/bank-sync-status';

/** A first fetch that has not failed: waiting to start, queued, running, or waiting out the bank's rate limit. */
const FETCHING: readonly BankSyncStatus[] = ['IDLE', 'QUEUED', 'RUNNING', 'RATE_LIMITED'];

/** Whether a bank is on its first fetch: connected, never fetched, and its fetch has not failed. */
export function onFirstFetch(connections: readonly BankConnection[]) {
  return connections.some(
    (connection) =>
      !isFileConnection(connection) &&
      connection.lastSyncedAt === null &&
      FETCHING.includes(connection.syncStatus),
  );
}

/**
 * Whether Home waits for its data instead of showing figures: a bank is on its first fetch and no transaction is in
 * yet, from any bank or file. `hasTransactions` is undefined while that is not known, and Home does not wait on it.
 */
export function awaitingFirstFetch(
  connections: readonly BankConnection[],
  hasTransactions: boolean | undefined,
) {
  return hasTransactions === false && onFirstFetch(connections);
}

/** The connections that can hold data: every bank, and the imported files while one of their accounts is left. */
export function withData(connections: readonly BankConnection[]) {
  return connections.filter(
    (connection) => !isFileConnection(connection) || connection.bankAccounts.length > 0,
  );
}
