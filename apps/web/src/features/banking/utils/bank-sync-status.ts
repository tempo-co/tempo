import {type BankConnection, CONSENT_ENDING_SOON_MS, SYNC_BROKEN_AFTER_MS} from '@tempo/contracts';

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

/** An authorized bank whose consent is still valid but ends within the window the owner is emailed in. */
export function isConsentEndingSoon(connection: BankConnection) {
  if (connection.status !== 'AUTHORIZED' || isReauthorizationRequired(connection)) return false;
  const timestamp = Date.parse(connection.consentValidUntil ?? '');
  return timestamp - Date.now() <= CONSENT_ENDING_SOON_MS;
}

type AutomaticSyncProblem = {
  title: string;
  description: string;
};

/**
 * Background sync is automatic and silent by design: only a status that needs attention
 * (rate-limited, failed or partial for too long, or expired consent) has anything to say.
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

/**
 * Failed, partial and rate-limited syncs retry on their own, so they only count once the bank has gone
 * `SYNC_BROKEN_AFTER_MS` without a fully successful sync (since it was connected, if it never had one),
 * when the owner is also emailed.
 */
function isSyncBroken(connection: BankConnection, now = Date.now()) {
  const lastSuccess = connection.lastSuccessfulSyncAt ?? connection.createdAt;
  return now - Date.parse(lastSuccess) >= SYNC_BROKEN_AFTER_MS;
}

export function getAutomaticSyncProblemForConnection(
  connection: BankConnection,
): AutomaticSyncProblem | null {
  if (!isConnectedBank(connection)) return null;
  if (isReauthorizationRequired(connection)) {
    return getAutomaticSyncProblem('EXPIRED', connection.lastSyncError);
  }
  if (!isSyncBroken(connection)) return null;
  return getAutomaticSyncProblem(connection.syncStatus, connection.lastSyncError);
}

/** The bank is waiting out a provider rate limit, so a refresh now would only be refused. */
export function isInRateLimitCooldown(connection: BankConnection, now = Date.now()) {
  if (connection.syncStatus !== 'RATE_LIMITED' || !connection.nextSyncAt) return false;
  return Date.parse(connection.nextSyncAt) > now;
}
