export const BANK_TRANSACTION_DIRECTIONS = {
	INCOME: 'INCOME',
	EXPENSE: 'EXPENSE',
	UNKNOWN: 'UNKNOWN',
} as const;

export type BankTransactionDirection = (typeof BANK_TRANSACTION_DIRECTIONS)[keyof typeof BANK_TRANSACTION_DIRECTIONS];

export function toBankTransactionDirection(indicator: string | null): BankTransactionDirection {
	const normalizedIndicator = indicator?.toUpperCase();
	if (normalizedIndicator === 'CRDT') return BANK_TRANSACTION_DIRECTIONS.INCOME;
	if (normalizedIndicator === 'DBIT') return BANK_TRANSACTION_DIRECTIONS.EXPENSE;
	return BANK_TRANSACTION_DIRECTIONS.UNKNOWN;
}
