import {type BankTransactionDirection, CREDIT_DEBIT_INDICATORS, type CreditDebitIndicator} from '@tempo/contracts';

export type {BankTransactionDirection, CreditDebitIndicator};
export {CREDIT_DEBIT_INDICATORS};

export const BANK_TRANSACTION_DIRECTIONS = {
	INCOME: 'INCOME',
	EXPENSE: 'EXPENSE',
} as const satisfies {[D in BankTransactionDirection]: D};

export function isCreditDebitIndicator(value: unknown): value is CreditDebitIndicator {
	return (CREDIT_DEBIT_INDICATORS as readonly unknown[]).includes(value);
}

export function toBankTransactionDirection(indicator: CreditDebitIndicator): BankTransactionDirection {
	return indicator === 'CRDT' ? BANK_TRANSACTION_DIRECTIONS.INCOME : BANK_TRANSACTION_DIRECTIONS.EXPENSE;
}
