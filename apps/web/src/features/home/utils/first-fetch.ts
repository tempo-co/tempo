import type {BankConnection, BankSyncStatus} from '@tempo/contracts';

import {isFileConnection} from '@/features/banking/utils/bank-sync-status';

/** A first fetch that has not failed: waiting to start, queued or running. */
const FETCHING: readonly BankSyncStatus[] = ['IDLE', 'QUEUED', 'RUNNING'];

/**
 * Whether Home waits for its data instead of showing figures: every connection is a bank connected for the first
 * time whose first fetch has not finished, nor failed. Imported files, or any bank that has synced once, show Home.
 */
export function awaitingFirstFetch(connections: readonly BankConnection[]) {
  const held = withData(connections);
  return (
    held.length > 0 &&
    held.every(
      (connection) =>
        !isFileConnection(connection) &&
        connection.lastSyncedAt === null &&
        FETCHING.includes(connection.syncStatus),
    )
  );
}

/** The connections that can hold data: every bank, and the imported files while one of their accounts is left. */
export function withData(connections: readonly BankConnection[]) {
  return connections.filter(
    (connection) => !isFileConnection(connection) || connection.bankAccounts.length > 0,
  );
}
