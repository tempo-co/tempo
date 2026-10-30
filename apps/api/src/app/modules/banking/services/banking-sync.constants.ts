import type {BankConnectionStatus, BankSyncStatus} from '@tempo/contracts';
import ms from 'ms';

export const BANK_CONNECTION_STATUSES = {
	AUTHORIZED: 'AUTHORIZED',
	EXPIRED: 'EXPIRED',
	RUNNING: 'RUNNING',
	PENDING_AUTHORIZATION: 'PENDING_AUTHORIZATION',
	CANCELLED: 'CANCELLED',
	FAILED: 'FAILED',
} as const satisfies {[S in BankConnectionStatus]: S};

export const BANK_SYNC_STATUSES = {
	IDLE: 'IDLE',
	QUEUED: 'QUEUED',
	RUNNING: 'RUNNING',
	SUCCEEDED: 'SUCCEEDED',
	PARTIAL: 'PARTIAL',
	FAILED: 'FAILED',
	RATE_LIMITED: 'RATE_LIMITED',
	EXPIRED: 'EXPIRED',
} as const satisfies {[S in BankSyncStatus]: S};

export const BANKING_DEFAULT_RETRY_AFTER_SECONDS = 6 * 60 * 60;
export const BANKING_MAX_RETRY_AFTER_SECONDS = 8_000_000_000_000;
export const BANKING_TRANSIENT_RETRY_BASE_MS = 15 * 60 * 1000;
/** A foreground refresh is skipped when the connection synchronized more recently than this. */
export const BANKING_FOREGROUND_REFRESH_MIN_INTERVAL_MS = 5 * 60 * 1000;

export function resolveDurationMs(value: string, key: string): number {
	const parsed = ms(value as ms.StringValue);
	if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed <= 0) {
		throw new Error(`${key} must be a positive duration.`);
	}
	return parsed;
}

export function isValidRetryAfterSeconds(seconds: number | null | undefined): seconds is number {
	return (
		seconds !== undefined &&
		seconds !== null &&
		Number.isFinite(seconds) &&
		seconds >= 0 &&
		seconds <= BANKING_MAX_RETRY_AFTER_SECONDS
	);
}

export function sanitizeRetryAfterSeconds(seconds: number | null | undefined): number {
	return isValidRetryAfterSeconds(seconds) ? seconds : BANKING_DEFAULT_RETRY_AFTER_SECONDS;
}
