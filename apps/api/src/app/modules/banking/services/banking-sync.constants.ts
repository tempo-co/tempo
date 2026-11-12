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

/** Connections that hold bank data: removing one deletes it, and re-authorizing the bank refreshes one in place. */
export const DESTRUCTIVE_CONNECTION_STATUSES = [
	BANK_CONNECTION_STATUSES.AUTHORIZED,
	BANK_CONNECTION_STATUSES.EXPIRED,
] as const;

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

/** The rate-limit cooldown when the provider sent no usable Retry-After. */
export const BANKING_DEFAULT_RETRY_AFTER_SECONDS = 6 * 60 * 60;
/** A rate-limit cooldown never ends sooner than this, so a zero or past Retry-After cannot cause a tight loop. */
export const BANKING_MIN_RETRY_AFTER_SECONDS = 15 * 60;
/** A rate-limit cooldown never lasts longer than this, so one odd Retry-After cannot stop syncing for weeks. */
export const BANKING_MAX_RETRY_AFTER_SECONDS = 24 * 60 * 60;
export const BANKING_TRANSIENT_RETRY_BASE_MS = 15 * 60 * 1000;
/**
 * How far back many banks serve transactions without the user present (Enable Banking FAQ: often 90 days once the
 * first hour after authorization has passed). No bank publishes its own limit.
 */
export const BANKING_UNATTENDED_HISTORY_DAYS = 90;
/** A foreground refresh is skipped when the connection synchronized more recently than this. */
export const BANKING_FOREGROUND_REFRESH_MIN_INTERVAL_MS = 5 * 60 * 1000;

export function resolveDurationMs(value: string, key: string): number {
	const parsed = ms(value as ms.StringValue);
	if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed <= 0) {
		throw new Error(`${key} must be a positive duration.`);
	}
	return parsed;
}

/** The cooldown to wait after a rate limit: the provider's Retry-After clamped to the allowed window. */
export function rateLimitCooldownSeconds(retryAfterSeconds: number | null | undefined): number {
	if (retryAfterSeconds === undefined || retryAfterSeconds === null || !Number.isFinite(retryAfterSeconds)) {
		return BANKING_DEFAULT_RETRY_AFTER_SECONDS;
	}
	return Math.min(BANKING_MAX_RETRY_AFTER_SECONDS, Math.max(BANKING_MIN_RETRY_AFTER_SECONDS, retryAfterSeconds));
}
