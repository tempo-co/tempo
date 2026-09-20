import type {BankConnection} from '../types/bank-connection';

/** True when the ISO timestamp parses to a real moment that is not in the future. */
export function isPastTimestamp(value: string | null | undefined, now = Date.now()): boolean {
  if (!value) return true;

  const timestamp = Date.parse(value);
  return !Number.isFinite(timestamp) || timestamp <= now;
}

export function isReauthorizationRequired(connection: BankConnection) {
  if (connection.status === 'EXPIRED' || connection.syncStatus === 'EXPIRED') return true;
  if (connection.status !== 'AUTHORIZED') return false;

  return isPastTimestamp(connection.consentValidUntil ?? null);
}

export function isStaleAutomaticSync(
  connection: BankConnection,
  status: BankConnection['syncStatus'] | 'EXPIRED',
  now = Date.now(),
) {
  return (
    connection.status === 'AUTHORIZED' &&
    status === 'SUCCEEDED' &&
    connection.lastSyncedAt !== null &&
    connection.nextSyncAt !== null &&
    Date.parse(connection.nextSyncAt) <= now
  );
}

export type AutomaticSyncStatus = BankConnection['syncStatus'] | 'EXPIRED';

export type AutomaticSyncDetails = {
  title: string;
  description: string;
  isProblem: boolean;
};

export function getAutomaticSyncDetails(
  status: AutomaticSyncStatus,
  error: string | null,
  lastSyncedAt: string | null,
  isStale: boolean,
): AutomaticSyncDetails {
  if (isStale) {
    return {
      title: 'Automatic sync is overdue',
      description: 'Saved bank data may be stale while the next background refresh is queued.',
      isProblem: true,
    };
  }

  switch (status) {
    case 'RATE_LIMITED':
      return {
        title: 'Automatic sync is rate-limited',
        description: 'The bank is temporarily limiting background access.',
        isProblem: true,
      };
    case 'EXPIRED':
      return {
        title: 'Re-authorization required',
        description: 'Consent expired. Re-authorize this bank connection to resume automatic sync.',
        isProblem: true,
      };
    case 'RUNNING':
      return {
        title: 'Automatic sync is in progress',
        description: 'Bank data is being refreshed in the background.',
        isProblem: false,
      };
    case 'QUEUED':
      return {
        title: 'Automatic sync is queued',
        description: 'The next bank refresh will run in the background.',
        isProblem: false,
      };
    case 'FAILED':
      return {
        title: 'Automatic sync needs attention',
        description: error || 'The next automatic attempt will retry in the background.',
        isProblem: true,
      };
    case 'PARTIAL':
      return {
        title: 'Automatic sync is partial',
        description: error || 'Some bank data could not be refreshed.',
        isProblem: true,
      };
    case 'SUCCEEDED':
      return {
        title: lastSyncedAt ? 'Automatic sync is active' : 'Automatic sync is pending',
        description: lastSyncedAt
          ? 'Bank data is refreshed automatically.'
          : 'The first bank refresh is running in the background.',
        isProblem: false,
      };
    default:
      return {
        title: 'Automatic sync is pending',
        description: 'The first bank refresh will run in the background.',
        isProblem: false,
      };
  }
}

export function getAutomaticSyncDetailsForConnection(
  connection: BankConnection,
): AutomaticSyncDetails | null {
  if (connection.status !== 'AUTHORIZED' && connection.status !== 'EXPIRED') return null;

  const status = isReauthorizationRequired(connection) ? 'EXPIRED' : connection.syncStatus;
  return getAutomaticSyncDetails(
    status,
    connection.lastSyncError,
    connection.lastSyncedAt,
    isStaleAutomaticSync(connection, status),
  );
}
