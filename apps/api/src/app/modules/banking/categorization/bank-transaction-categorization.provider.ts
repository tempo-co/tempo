import type {BankTransactionCategoryDefinition} from '@tempo/contracts';

import type {
	BankTransactionCategorizationInput,
	BankTransactionCategorizationResult,
	BankTransactionCategorizationWebSearchInput,
	BankTransactionCategorizationWebSearchOutcome,
} from './bank-transaction-categorization.types';

export const BANK_TRANSACTION_CATEGORIZATION_PROVIDER = Symbol('BANK_TRANSACTION_CATEGORIZATION_PROVIDER');

export interface BankTransactionCategorizationProvider {
	categorize(
		transactions: readonly BankTransactionCategorizationInput[],
		categories: readonly BankTransactionCategoryDefinition[],
	): Promise<readonly BankTransactionCategorizationResult[]>;
	categorizeWithWebSearch(
		transactions: readonly BankTransactionCategorizationWebSearchInput[],
		categories: readonly BankTransactionCategoryDefinition[],
	): Promise<readonly BankTransactionCategorizationWebSearchOutcome[]>;
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
