export const BANK_TRANSACTION_CATEGORIZATION_PROMPT_VERSION = 'bank-transaction-categorization-v7';
export const BANK_TRANSACTION_CATEGORIZATION_MANUAL_HISTORY_PROMPT_VERSION = 'bank-transaction-manual-history-v1';
export const BANK_TRANSACTION_CATEGORIZATION_MANUAL_HISTORY_PROVIDER = 'manual-history';
export const BANK_TRANSACTION_CATEGORIZATION_WEB_SEARCH_PROMPT_VERSION =
	'bank-transaction-categorization-web-search-v7';
export const BANK_TRANSACTION_CATEGORIZATION_WEB_SEARCH_SKIPPED_PROMPT_VERSION =
	'bank-transaction-categorization-web-search-skipped-v5';
export const BANK_TRANSACTION_CATEGORIZATION_WEB_SEARCH_FAILED_PROMPT_VERSION =
	'bank-transaction-categorization-web-search-failed-v5';
export const BANK_TRANSACTION_CATEGORIZATION_PROVIDER_NAME = 'openai';
export const BANK_TRANSACTION_CATEGORIZATION_REQUEST_TIMEOUT_MS = 30_000;
export const BANK_TRANSACTION_CATEGORIZATION_MAX_WEB_SEARCH_QUERY_LENGTH = 240;
export const BANK_TRANSACTION_CATEGORIZATION_MAX_SEARCH_TRACE_ITEMS = 20;
export const BANK_TRANSACTION_CATEGORIZATION_RESET_VALUES = {
	category: null,
	categorySource: null,
	categoryConfidence: null,
	categoryAppliedInputHash: null,
	categoryProvider: null,
	categoryModel: null,
	categoryPromptVersion: null,
	categorySearchTrace: null,
	categoryLastError: null,
} as const;
