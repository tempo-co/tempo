import {
	BALANCE_TREND_INTERVALS,
	BREAKDOWN_INTERVALS,
	type BalanceTrendInterval,
	CASH_FLOW_INTERVALS,
	MAX_RANGE_PERIODS,
} from '@tempo/contracts';

const RANGE_UNITS: Record<BalanceTrendInterval, string> = {day: 'days', week: 'weeks', month: 'months', year: 'years'};

/** The range error for a request taking these intervals, naming each one's limit from `MAX_RANGE_PERIODS`. */
function rangeMessage(subject: string, intervals: readonly BalanceTrendInterval[]): string {
	const limits = intervals.map((interval) => `${MAX_RANGE_PERIODS[interval]} ${RANGE_UNITS[interval]}`);
	const last = limits.pop();
	return `The ${subject} range must run forward, end by the given date and cover at most ${limits.join(', ')} or ${last}.`;
}

export const BANKING_SERVICE_UNAVAILABLE = 'Banking service is temporarily unavailable. Please try again.';
export const BANKING_INTERNAL_ERROR = 'Unable to process the bank connection.';
export const BANKING_SUPPORTED_BANKS_UNAVAILABLE = 'Unable to load supported banks.';
export const BANKING_AUTHORIZATION_START_FAILED = 'Unable to start bank authorization.';
export const BANKING_SELECTED_BANK_UNAVAILABLE = 'The selected bank is not available.';

export const BANKING_CONNECTION_NOT_FOUND = 'Bank connection not found.';
export const BANKING_CONNECTION_NOT_REMOVABLE = 'This bank connection cannot be removed in its current state.';
export const BANKING_CONNECTION_REMOVAL_CONFIRMATION_REQUIRED =
	'Type DELETE to confirm removal of this connected bank.';
export const BANKING_CONNECTION_NOT_AUTHORIZED = 'Bank connection is not authorized.';
export const BANKING_CONNECTION_SESSION_UNAVAILABLE = 'Bank connection session is unavailable. Please reconnect.';
export const BANKING_CONSENT_EXPIRED = 'Bank consent has expired. Please reconnect.';

export const BANKING_PARTIAL_SYNC_ERROR = 'Some bank data could not be synchronized.';
export const BANKING_FAILED_SYNC_ERROR = 'Bank synchronization failed.';
export const BANKING_RATE_LIMITED_SYNC_ERROR =
	'Bank access is temporarily rate-limited. The next automatic attempt will wait for the provider cooldown.';
export const BANKING_PERSISTENCE_SYNC_ERROR = 'Bank synchronization could not be saved.';
export const BANKING_SYNC_ALREADY_IN_PROGRESS = 'A bank synchronization is already in progress.';
export const BANKING_REFRESH_CONTEXT_UNAVAILABLE =
	'Browser context required by this bank is unavailable. Please try again from your browser.';

export const BANKING_TRANSACTION_NOT_FOUND = 'Bank transaction not found.';
export const BANKING_RECURRING_SERIES_NOT_FOUND = 'Recurring payment not found.';
export const BANKING_RECURRING_CONTINUATION_CHANGED = 'This recurring payment changed. Please try again.';
export const BANKING_RECURRING_SERIES_KEY_INVALID = 'Recurring payment key must be 32 lowercase hex characters.';
export const MERCHANT_LOGO_NOT_FOUND = 'Merchant logo not found.';
export const BANKING_TRANSACTION_SUMMARY_FUTURE_MONTH = 'The summary month cannot start after the given date.';
export const BANKING_BALANCE_TREND_RANGE = rangeMessage('balance trend', BALANCE_TREND_INTERVALS);
export const BANKING_TRANSACTION_CASH_FLOW_RANGE = rangeMessage('cash flow', CASH_FLOW_INTERVALS);
export const BANKING_TRANSACTION_BREAKDOWN_RANGE = rangeMessage('breakdown', BREAKDOWN_INTERVALS);
export const MERCHANT_NOT_FOUND = 'Merchant not found.';
export const MERCHANT_GROUP_ID_INVALID = 'Merchant id must be b_ or k_ followed by 32 lowercase hex characters.';
export const MERCHANT_PERIODS_RANGE = rangeMessage('merchant period', CASH_FLOW_INTERVALS);
export const MERCHANT_RANKING_FUTURE_PERIOD = 'The ranked period cannot start after the given date.';
