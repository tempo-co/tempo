import type {BankTransactionDirection} from '@tempo/contracts';

export type {BankTransactionDirection};

export const BANK_TRANSACTION_DIRECTIONS = {
	INCOME: 'INCOME',
	EXPENSE: 'EXPENSE',
	UNKNOWN: 'UNKNOWN',
} as const satisfies {[D in BankTransactionDirection]: D};

export function toBankTransactionDirection(indicator: string | null): BankTransactionDirection {
	const normalizedIndicator = indicator?.toUpperCase();
	if (normalizedIndicator === 'CRDT') return BANK_TRANSACTION_DIRECTIONS.INCOME;
	if (normalizedIndicator === 'DBIT') return BANK_TRANSACTION_DIRECTIONS.EXPENSE;
	return BANK_TRANSACTION_DIRECTIONS.UNKNOWN;
}
