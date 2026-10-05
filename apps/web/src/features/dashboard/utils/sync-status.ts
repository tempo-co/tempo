import {differenceInCalendarDays, format} from 'date-fns';

import type {BankConnection} from '@/features/banking/types/bank-connection';
import {getAutomaticSyncDetailsForConnection} from '@/features/banking/utils/bank-sync-status';

const CONSENT_WARNING_DAYS = 7;

export type HomeSyncStatus = {
  /** Connections whose sync failed or whose consent ended; their data may be behind. */
  problems: BankConnection[];
  /** Connections whose consent ends within a week. */
  expiringConsents: {connection: BankConnection; daysLeft: number}[];
  /** The oldest last sync across connections, or null when one has never synced. */
  oldestSyncedAt: string | null;
};

/** "not synced since 3 Oct", or "not synced yet" for a connection that never synced. */
export function formatNotSyncedSince(connection: BankConnection) {
  return connection.lastSyncedAt
    ? `not synced since ${format(new Date(connection.lastSyncedAt), 'd MMM')}`
    : 'not synced yet';
}

export function getHomeSyncStatus(connections: BankConnection[], now = new Date()): HomeSyncStatus {
  const problems = connections.filter(
    (connection) => getAutomaticSyncDetailsForConnection(connection)?.isProblem,
  );
  const expiringConsents = connections.flatMap((connection) => {
    if (problems.includes(connection) || !connection.consentValidUntil) return [];
    const daysLeft = differenceInCalendarDays(new Date(connection.consentValidUntil), now);
    return daysLeft <= CONSENT_WARNING_DAYS ? [{connection, daysLeft}] : [];
  });
  const syncTimes = connections.map((connection) => connection.lastSyncedAt);
  const oldestSyncedAt = syncTimes.includes(null)
    ? null
    : (syncTimes as string[]).reduce((oldest, value) => (value < oldest ? value : oldest));

  return {problems, expiringConsents, oldestSyncedAt};
}
