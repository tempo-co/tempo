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

export const BANKING_TRANSACTION_NOT_FOUND = 'Bank transaction not found.';
export const BANKING_TRANSACTION_SUMMARY_FUTURE_MONTH = 'The summary month cannot start after the given date.';
export const BANKING_TRANSACTION_CASH_FLOW_RANGE =
	'The cash flow range must run forward, end by the given date and cover at most 104 weeks, 60 months or 10 years.';
