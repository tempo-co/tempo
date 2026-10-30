import {getRuleCategory} from './bank-transaction-category-rules';

const TAP = 'BEA, Betaalpas NLOVEXAMPLE0TAP0001,PAS123 NR:EX0001, 01.01.26/08:00 www.ovpay.nl';

describe('getRuleCategory', () => {
	it('categorizes an OVpay card tap as transportation', () => {
		expect(getRuleCategory({description: TAP, creditDebitIndicator: 'DBIT'})).toBe('TRANSPORTATION');
		expect(getRuleCategory({description: TAP.replace('www.', ''), creditDebitIndicator: 'dbit'})).toBe(
			'TRANSPORTATION',
		);
	});

	it.each([
		['an OVpay refund', {description: TAP, creditDebitIndicator: 'CRDT'}],
		[
			'a card line elsewhere',
			{description: TAP.replace('www.ovpay.nl', 'EXAMPLETOWN'), creditDebitIndicator: 'DBIT'},
		],
		[
			'a transfer mentioning OVpay',
			{description: 'SEPA Overboeking Omschrijving: www.ovpay.nl', creditDebitIndicator: 'DBIT'},
		],
		['an empty description', {description: null, creditDebitIndicator: 'DBIT'}],
	])('leaves %s to history or the model', (_, transaction) => {
		expect(getRuleCategory(transaction)).toBeNull();
	});
});
