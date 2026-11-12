import {safeErrorName} from './banking.utils';
import {EnableBankingClientError} from './services/enable-banking.client';

/**
 * Why part of a sync run failed. Stored in `bank_sync_runs.failures` and logged, so it holds only our own ids,
 * provider error codes and HTTP statuses: never provider messages, bodies or financial data.
 */
export type BankSyncFailure = {
	/**
	 * The provider call that failed, `internal` for an unexpected exception, `cancelled` for an aborted refresh,
	 * `interrupted` for a run whose process stopped before finishing it.
	 */
	kind: 'session' | 'balances' | 'transactions' | 'internal' | 'cancelled' | 'interrupted';
	/** Tempo's bank account id for per-account calls. */
	bankAccountId: string | null;
	code: string;
	httpStatus: number | null;
	retryAfter: boolean;
	/** Transactions the provider sent without a usable amount or currency, which were not imported. */
	droppedTransactions?: number;
};

export const UNPARSEABLE_TRANSACTIONS_CODE = 'unparseable_transactions';
export const INTERRUPTED_SYNC_CODE = 'sync_interrupted';

/**
 * Enable Banking error codes (API reference, `ErrorCode`) meaning the session no longer grants access, plus
 * Tempo's own code for a session the provider reports in another status than AUTHORIZED. Only re-authorization helps.
 */
const SESSION_ENDED_CODES = new Set([
	'CLOSED_SESSION',
	'EXPIRED_SESSION',
	'REVOKED_SESSION',
	'SESSION_DOES_NOT_EXIST',
	'PROVIDER_SESSION_NOT_AUTHORIZED',
]);
/** Enable Banking error codes for rate limits; HTTP 429 counts as one whatever its code. */
const RATE_LIMIT_CODES = new Set(['ASPSP_RATE_LIMIT_EXCEEDED']);
/**
 * Enable Banking refusing Tempo's own application credentials (JWT, key, clock or allowed IP) rather than the
 * user's session, plus Tempo failing to sign its JWT. HTTP 401 with any code other than a session one counts too.
 */
const APPLICATION_AUTH_CODES = new Set([
	'AUTHORIZATION_NOT_PROVIDED',
	'UNAUTHORIZED_ACCESS',
	'UNAUTHORIZED_IP',
	'PROVIDER_AUTHENTICATION_FAILED',
]);

/**
 * How a failed provider call affects the run: `session_ended` expires the connection, `rate_limited` and
 * `application_auth` stop the run's remaining calls (the first with a cooldown, the second for an ordinary retry),
 * and `failed` fails only that call.
 */
export type ProviderFailureClass = 'session_ended' | 'rate_limited' | 'application_auth' | 'failed';

export function classifyProviderFailure(error: unknown): ProviderFailureClass {
	if (!(error instanceof EnableBankingClientError)) return 'failed';
	const code = error.code
		.trim()
		.toUpperCase()
		.replace(/[\s-]+/g, '_');
	if (SESSION_ENDED_CODES.has(code)) return 'session_ended';
	if (error.providerStatus === 429 || RATE_LIMIT_CODES.has(code)) return 'rate_limited';
	if (error.providerStatus === 401 || APPLICATION_AUTH_CODES.has(code)) return 'application_auth';
	return 'failed';
}

export function toBankSyncFailure(
	error: unknown,
	kind: BankSyncFailure['kind'],
	bankAccountId: string | null = null,
): BankSyncFailure {
	if (error instanceof EnableBankingClientError) {
		return {
			kind,
			bankAccountId,
			// The code comes from the provider's response, so only plain code characters are kept.
			code: error.code.replace(/[^\w.-]/g, '_').slice(0, 100),
			httpStatus: error.providerStatus ?? null,
			retryAfter: error.retryAfterPresent,
		};
	}
	return {kind, bankAccountId, code: safeErrorName(error), httpStatus: null, retryAfter: false};
}

/** One log line per failure list: kinds, codes, statuses and our ids only. */
export function describeBankSyncFailures(failures: readonly BankSyncFailure[]): string {
	return failures
		.map((failure) =>
			[
				failure.bankAccountId ? `${failure.kind}[${failure.bankAccountId}]` : failure.kind,
				failure.code,
				...(failure.httpStatus ? [`HTTP ${failure.httpStatus}`] : []),
				...(failure.retryAfter ? ['Retry-After'] : []),
				...(failure.droppedTransactions ? [`dropped ${failure.droppedTransactions}`] : []),
			].join(' '),
		)
		.join(', ');
}

/** The error name and stack frames, without the message, which can carry data and span several lines. */
export function safeErrorStack(error: unknown): string {
	const name = safeErrorName(error);
	if (!(error instanceof Error) || typeof error.stack !== 'string') return name;
	const messageEnd = error.message ? error.stack.indexOf(error.message) : -1;
	if (error.message && messageEnd < 0) return name;
	const frames = (
		messageEnd < 0
			? error.stack.slice(error.stack.indexOf('\n') + 1)
			: error.stack.slice(messageEnd + error.message.length)
	)
		.split('\n')
		.filter((line) => /^\s+at /.test(line));
	return [name, ...frames].join('\n');
}
