import {safeErrorName} from './banking.utils';
import {EnableBankingClientError} from './services/enable-banking.client';

/**
 * Why part of a sync run failed. Stored in `bank_sync_runs.failures` and logged, so it holds only our own ids,
 * provider error codes and HTTP statuses: never provider messages, bodies or financial data.
 */
export type BankSyncFailure = {
	/** The provider call that failed, `internal` for an unexpected exception, `cancelled` for an aborted refresh. */
	kind: 'session' | 'balances' | 'transactions' | 'internal' | 'cancelled';
	/** Tempo's bank account id for per-account calls. */
	bankAccountId: string | null;
	code: string;
	httpStatus: number | null;
	retryAfter: boolean;
	/** Transactions the provider sent without a usable amount or currency, which were not imported. */
	droppedTransactions?: number;
};

export const UNPARSEABLE_TRANSACTIONS_CODE = 'unparseable_transactions';

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
