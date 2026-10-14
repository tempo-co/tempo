import {getBankTransactionMerchantKey} from './bank-transaction-merchant-key';

describe('getBankTransactionMerchantKey', () => {
	it.each([
		['BEA, Google Pay BCK*Example Rail 201,PAS123 NR:EX0001, 01.02.26/10:00 EXAMPLETOWN', 'EXPENSE:example rail'],
		['BEA, Betaalpas Example Rail 305,PAS123 NR:EX0002, 03.01.26/09:00 EXAMPLETOWN', 'EXPENSE:example rail'],
		['BEA, Apple Pay CCV*Example Cafe,PAS123 NR:EX0003, 04.01.26/12:30 OTHERTOWN', 'EXPENSE:example cafe'],
		['GEA, Betaalpas Example Bank Atm 12,PAS123 NR:EX0004, 05.01.26/18:00 EXAMPLETOWN', 'EXPENSE:example bank atm'],
	])('normalizes the card line %s', (description, expected) => {
		expect(getBankTransactionMerchantKey({description, counterpartyName: null, creditDebitIndicator: 'DBIT'})).toBe(
			expected,
		);
	});

	it('uses the structured SEPA name, then the counterparty name, then the description', () => {
		expect(
			getBankTransactionMerchantKey({
				description: 'SEPA iDEAL IBAN: NL91ABNA0417164300 BIC: ABNANL2A Naam: Example Shop Omschrijving: order',
				counterpartyName: null,
				creditDebitIndicator: 'DBIT',
			}),
		).toBe('EXPENSE:example shop');
		expect(
			getBankTransactionMerchantKey({
				description: 'Payment 123',
				counterpartyName: '  Example   Shop ',
				creditDebitIndicator: 'DBIT',
			}),
		).toBe('EXPENSE:example shop');
		expect(
			getBankTransactionMerchantKey({
				description: 'Example Shop',
				counterpartyName: null,
				creditDebitIndicator: 'CRDT',
			}),
		).toBe('INCOME:example shop');
	});

	it.each([
		['Example Games via Exam ple Pay', 'EXPENSE:example games'],
		['Example Games via Ex', 'EXPENSE:example games'],
		['Example Games via', 'EXPENSE:example games'],
		['Example Games, via Example Pay', 'EXPENSE:example games'],
		['Example Rail B.V. by Example Pay', 'EXPENSE:example rail b.v.'],
		['EXAMPLE GAMES VIA EXAMPLE PAY', 'EXPENSE:example games'],
		['Example Games', 'EXPENSE:example games'],
		['Example by Night', 'EXPENSE:example by night'],
		['Pizza by the Slice', 'EXPENSE:pizza by the slice'],
		['Caffe via Example', 'EXPENSE:caffe via example'],
		[', via Example Pay', 'EXPENSE:, via example pay'],
	])('keys the counterparty %s without a payment-processor tail', (counterpartyName, expected) => {
		expect(getBankTransactionMerchantKey({description: null, counterpartyName, creditDebitIndicator: 'DBIT'})).toBe(
			expected,
		);
	});

	it('drops the processor tail from a structured SEPA name but not from a plain description', () => {
		expect(
			getBankTransactionMerchantKey({
				description:
					'SEPA iDEAL IBAN: NL91ABNA0417164300 BIC: ABNANL2A Naam: Example Games via Ex Omschrijving: x',
				counterpartyName: null,
				creditDebitIndicator: 'DBIT',
			}),
		).toBe('EXPENSE:example games');
		expect(
			getBankTransactionMerchantKey({
				description: 'Refund by Example Shop',
				counterpartyName: null,
				creditDebitIndicator: 'CRDT',
			}),
		).toBe('INCOME:refund by example shop');
	});

	it.each([
		'PayPal Europe S.a.r.l.',
		'PayPal (Europe) S.a r.l. et Cie, S.C.A.',
		'Klarna Bank AB',
		'Stripe Technology Europe Ltd',
		'Mollie B.V.',
		'Stichting Mollie Payments',
		'Adyen N.V.',
		'Tikkie',
	])('does not treat the payment processor %s as a merchant', (counterpartyName) => {
		expect(
			getBankTransactionMerchantKey({
				description: 'order 123',
				counterpartyName,
				creditDebitIndicator: 'DBIT',
			}),
		).toBeNull();
	});

	it('separates directions and rejects empty merchants', () => {
		const base = {description: null, counterpartyName: 'Example Shop'};
		expect(getBankTransactionMerchantKey({...base, creditDebitIndicator: 'DBIT'})).not.toBe(
			getBankTransactionMerchantKey({...base, creditDebitIndicator: 'CRDT'}),
		);
		expect(
			getBankTransactionMerchantKey({description: ' ', counterpartyName: null, creditDebitIndicator: 'DBIT'}),
		).toBeNull();
	});
});
