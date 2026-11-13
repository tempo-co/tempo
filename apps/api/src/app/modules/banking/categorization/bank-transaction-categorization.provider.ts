import type {BankTransactionCategoryDefinition} from '@tempo/contracts';

import type {
	BankTransactionCategorizationInput,
	BankTransactionCategorizationResult,
} from './bank-transaction-categorization.types';

export const BANK_TRANSACTION_CATEGORIZATION_PROVIDER = Symbol('BANK_TRANSACTION_CATEGORIZATION_PROVIDER');

export interface BankTransactionCategorizationProvider {
	/**
	 * Categorizes one row group. With `searchQuery`, the call may first be informed by one web search for that
	 * merchant query; results informed by a search that ran carry a search trace.
	 */
	categorize(
		transactions: readonly BankTransactionCategorizationInput[],
		categories: readonly BankTransactionCategoryDefinition[],
		options?: {searchQuery?: string},
	): Promise<readonly BankTransactionCategorizationResult[]>;
}

export class BankTransactionCategorizationProviderError extends Error {
	constructor(
		message: string,
		readonly retryable: boolean,
	) {
		super(message);
		this.name = 'BankTransactionCategorizationProviderError';
	}
}

/** Nothing ran on either Claude route and a later retry can succeed; leave the transaction pending. */
export class BankTransactionCategorizationUnavailableError extends BankTransactionCategorizationProviderError {
	constructor() {
		super('Claude categorization is temporarily unavailable.', true);
		this.name = 'BankTransactionCategorizationUnavailableError';
	}
}
