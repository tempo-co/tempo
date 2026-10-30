import {BANK_TRANSACTION_DIRECTIONS, toBankTransactionDirection} from './bank-transaction-direction';

describe('toBankTransactionDirection', () => {
	it.each([
		['CRDT', BANK_TRANSACTION_DIRECTIONS.INCOME],
		['dbit', BANK_TRANSACTION_DIRECTIONS.EXPENSE],
		[null, BANK_TRANSACTION_DIRECTIONS.UNKNOWN],
		['unknown', BANK_TRANSACTION_DIRECTIONS.UNKNOWN],
	])('%s maps to %s', (indicator, expected) => {
		expect(toBankTransactionDirection(indicator)).toBe(expected);
	});
});
