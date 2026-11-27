import type {BankConnection, BankSyncStatus} from '@tempo/contracts';

import {isFileConnection} from '@/features/banking/utils/bank-sync-status';

/** A first fetch that has not failed: waiting to start, queued or running. */
const FETCHING: readonly BankSyncStatus[] = ['IDLE', 'QUEUED', 'RUNNING'];

/**
 * Whether Home waits for its data instead of showing figures: every connection is a bank connected for the first
 * time whose first fetch has not finished, nor failed. Imported files, or any bank that has synced once, show Home.
 */
export function awaitingFirstFetch(connections: readonly BankConnection[]) {
  return (
    connections.length > 0 &&
    connections.every(
      (connection) =>
        !isFileConnection(connection) &&
        connection.lastSyncedAt === null &&
        FETCHING.includes(connection.syncStatus),
    )
  );
}
