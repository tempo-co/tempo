import {BANK_TRANSACTION_TYPES, normalizeBankTransactionType} from './bank-transaction-type';

describe('normalizeBankTransactionType', () => {
	it.each([
		[
			'structured card classifications',
			{code: 'PMNT', subCode: 'CARD', description: 'Card payment'},
			BANK_TRANSACTION_TYPES.CARD_PAYMENT,
		],
		[
			'provider-scoped numeric card classifications',
			{code: '426', aspspName: 'ABN AMRO'},
			BANK_TRANSACTION_TYPES.CARD_PAYMENT,
		],
		[
			'structured transfer classifications',
			{code: 'PMNT', subCode: 'TRANSFER', description: 'SEPA transfer'},
			BANK_TRANSACTION_TYPES.TRANSFER,
		],
		[
			'structured direct debit classifications',
			{code: 'PMNT', subCode: 'DD', description: 'Direct debit'},
			BANK_TRANSACTION_TYPES.DIRECT_DEBIT,
		],
		[
			'structured cash withdrawal classifications',
			{code: 'ATM', description: 'ATM cash withdrawal'},
			BANK_TRANSACTION_TYPES.CASH_WITHDRAWAL,
		],
		['structured fee classifications', {code: 'CHRG', description: 'Bank fee'}, BANK_TRANSACTION_TYPES.FEE],
		[
			'structured interest classifications',
			{code: 'INT', description: 'Interest payment'},
			BANK_TRANSACTION_TYPES.INTEREST,
		],
		[
			'structured salary classifications',
			{code: 'SALA', description: 'Salary payment'},
			BANK_TRANSACTION_TYPES.SALARY,
		],
		['structured refund classifications', {code: 'RIMB', description: 'Refund'}, BANK_TRANSACTION_TYPES.REFUND],
	])('%s', (_label, classification, expected) => {
		expect(normalizeBankTransactionType(classification)).toBe(expected);
	});

	it.each([
		['description-only fee', {description: 'Monthly account fee'}, BANK_TRANSACTION_TYPES.OTHER],
		[
			'iDEAL payment descriptions remain unresolved without a structured code',
			{code: '944', description: 'SEPA IDEAL TRANSFERS'},
			BANK_TRANSACTION_TYPES.OTHER,
		],
		['description-only card payment', {description: 'Card payment at a merchant'}, BANK_TRANSACTION_TYPES.OTHER],
		['unscoped numeric code remains unresolved', {code: '426'}, BANK_TRANSACTION_TYPES.OTHER],
		[
			'numeric code from another ASPSP remains unresolved',
			{code: '426', aspspName: 'Synthetic Bank'},
			BANK_TRANSACTION_TYPES.OTHER,
		],
		['description-only direct debit', {description: 'Direct debit'}, BANK_TRANSACTION_TYPES.OTHER],
		['description-only cash withdrawal', {description: 'ATM cash withdrawal'}, BANK_TRANSACTION_TYPES.OTHER],
		['description-only salary', {description: 'Salary payment'}, BANK_TRANSACTION_TYPES.OTHER],
		['description-only refund', {description: 'Refund'}, BANK_TRANSACTION_TYPES.OTHER],
		[
			'structured card code takes precedence over the description',
			{code: 'PMNT', subCode: 'CARD', description: 'Coffee shop'},
			BANK_TRANSACTION_TYPES.CARD_PAYMENT,
		],
		['deposit descriptions', {description: 'Bank deposit'}, BANK_TRANSACTION_TYPES.OTHER],
	])('%s', (_label, classification, expected) => {
		expect(normalizeBankTransactionType(classification)).toBe(expected);
	});

	it('uses OTHER when the provider classification is absent or unknown', () => {
		expect(normalizeBankTransactionType({})).toBe(BANK_TRANSACTION_TYPES.OTHER);
		expect(normalizeBankTransactionType({code: 'ZZZZ', subCode: 'UNKNOWN', description: 'Something else'})).toBe(
			BANK_TRANSACTION_TYPES.OTHER,
		);
	});
});
