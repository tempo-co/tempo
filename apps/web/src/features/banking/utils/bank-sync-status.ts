import type {BankConnection} from '@tempo/contracts';

/** True when the ISO timestamp parses to a real moment that is not in the future. */
function isPastTimestamp(value: string | null | undefined, now = Date.now()): boolean {
  if (!value) return true;

  const timestamp = Date.parse(value);
  return !Number.isFinite(timestamp) || timestamp <= now;
}

/** Connections that can hold accounts: authorized now or authorized before their consent ended. */
export function isConnectedBank(connection: BankConnection) {
  return connection.status === 'AUTHORIZED' || connection.status === 'EXPIRED';
}

export function isSyncInProgress(connection: BankConnection) {
  return connection.syncStatus === 'QUEUED' || connection.syncStatus === 'RUNNING';
}

export function isReauthorizationRequired(connection: BankConnection) {
  if (connection.status === 'EXPIRED' || connection.syncStatus === 'EXPIRED') return true;
  if (connection.status !== 'AUTHORIZED') return false;

  return isPastTimestamp(connection.consentValidUntil);
}

export type AutomaticSyncProblem = {
  title: string;
  description: string;
};

/**
 * Background sync is automatic and silent by design: only a status that needs attention
 * (rate-limited, failed, partial or expired consent) has anything to say.
 */
function getAutomaticSyncProblem(
  status: BankConnection['syncStatus'],
  error: string | null,
): AutomaticSyncProblem | null {
  switch (status) {
    case 'RATE_LIMITED':
      return {
        title: 'Automatic sync is rate-limited',
        description: 'The bank is temporarily limiting background access.',
      };
    case 'EXPIRED':
      return {
        title: 'Re-authorization required',
        description: 'Consent expired. Re-authorize this bank connection to resume automatic sync.',
      };
    case 'FAILED':
      return {
        title: 'Automatic sync needs attention',
        description: error || 'The next automatic attempt will retry in the background.',
      };
    case 'PARTIAL':
      return {
        title: 'Automatic sync is partial',
        description: error || 'Some bank data could not be refreshed.',
      };
    default:
      return null;
  }
}

export function getAutomaticSyncProblemForConnection(
  connection: BankConnection,
): AutomaticSyncProblem | null {
  if (!isConnectedBank(connection)) return null;

  const status = isReauthorizationRequired(connection) ? 'EXPIRED' : connection.syncStatus;
  return getAutomaticSyncProblem(status, connection.lastSyncError);
}
