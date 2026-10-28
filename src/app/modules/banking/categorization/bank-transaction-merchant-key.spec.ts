import {getBankTransactionMerchantKey, parseMerchantKey} from './bank-transaction-merchant-key';

it.each<[string, {direction: string; name: string}]>([
	['EXPENSE:example shop', {direction: 'EXPENSE', name: 'example shop'}],
	['INCOME:example payer', {direction: 'INCOME', name: 'example payer'}],
	['UNKNOWN:example name', {direction: 'UNKNOWN', name: 'example name'}],
	['EXPENSE:automatic-recurring:example', {direction: 'EXPENSE', name: 'automatic-recurring:example'}],
])('parses the direction and full name of %s', (key, expected) => {
	expect(parseMerchantKey(key)).toEqual(expected);
});

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

	it.each([
		['DBIT', 'Transfer to ALEX-SAM EXAMPLE', 'Alex-Sam Exämple', 'EXPENSE:alex-sam example'],
		['CRDT', 'Transfer from ALEX SAM EXAMPLE', 'Alex Sam Exämple', 'INCOME:alex sam example'],
	])(
		'keys %s transfers by their full payee name',
		(creditDebitIndicator, description, counterpartyName, expected) => {
			expect(getBankTransactionMerchantKey({description, counterpartyName: null, creditDebitIndicator})).toBe(
				expected,
			);
			expect(getBankTransactionMerchantKey({description: null, counterpartyName, creditDebitIndicator})).toBe(
				expected,
			);
			expect(
				getBankTransactionMerchantKey({
					description: null,
					counterpartyName: 'Alex Example',
					creditDebitIndicator,
				}),
			).not.toBe(expected);
			expect(
				getBankTransactionMerchantKey({
					description: null,
					counterpartyName: 'Alex-Jo Example',
					creditDebitIndicator,
				}),
			).not.toBe(expected);
		},
	);

	it.each([
		['Transfer to Example', 'DBIT', 'EXPENSE:transfer to example'],
		['Transfer from Alex Example', 'DBIT', 'EXPENSE:transfer from alex example'],
		['Transfer to Alex Example', 'CRDT', 'INCOME:transfer to alex example'],
	])('keeps the ambiguous transfer text %s in direction %s', (description, creditDebitIndicator, expected) => {
		expect(getBankTransactionMerchantKey({description, creditDebitIndicator})).toBe(expected);
	});

	it('gives no key to a transfer that names only a payment processor', () => {
		expect(
			getBankTransactionMerchantKey({description: 'Transfer to PayPal Europe', creditDebitIndicator: 'DBIT'}),
		).toBeNull();
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
		['Example Rail B.V. by Example Pay', 'EXPENSE:example rail'],
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
		['Example Shop EU S.a r.l.', 'EXPENSE:example shop'],
		['Example Shop Payments Europe S.C.A.', 'EXPENSE:example shop'],
		['Example Shop Payments Europe S', 'EXPENSE:example shop'],
		['Example Shop B.V.', 'EXPENSE:example shop'],
		['Example Shop BV', 'EXPENSE:example shop'],
		['Example Shop Nederland B. V.', 'EXPENSE:example shop'],
		['Example Shop GmbH', 'EXPENSE:example shop'],
		['Example Shop, Ltd.', 'EXPENSE:example shop'],
		['Example Shop AB', 'EXPENSE:example shop'],
		['Example Shop S.A.', 'EXPENSE:example shop'],
		['Example Shop B.V.,', 'EXPENSE:example shop'],
		['Example Shop,', 'EXPENSE:example shop'],
		['EXAMPLE SHOP SA', 'EXPENSE:example shop'],
		['Example Shop (Europe) B.V.', 'EXPENSE:example shop'],
		['Example Shop Europe B', 'EXPENSE:example shop'],
		['Example Shop B.V. via Example Pay', 'EXPENSE:example shop'],
		['Example Shop', 'EXPENSE:example shop'],
		['Europe B.V.', 'EXPENSE:europe'],
	])('keys the legal entity %s as its business', (counterpartyName, expected) => {
		expect(getBankTransactionMerchantKey({description: null, counterpartyName, creditDebitIndicator: 'DBIT'})).toBe(
			expected,
		);
	});

	it.each([
		['Example Payments', 'EXPENSE:example payments'],
		['Example Shop Europe', 'EXPENSE:example shop europe'],
		['Maria Ab', 'EXPENSE:maria ab'],
		['Joana Sa', 'EXPENSE:joana sa'],
		['JOANA SA', 'EXPENSE:joana sa'],
		['Example Shop Europe A', 'EXPENSE:example shop europe a'],
		['Example Ab Testing', 'EXPENSE:example ab testing'],
		['Example Bevel', 'EXPENSE:example bevel'],
	])('keeps every word of %s, which has no legal form', (counterpartyName, expected) => {
		expect(getBankTransactionMerchantKey({description: null, counterpartyName, creditDebitIndicator: 'DBIT'})).toBe(
			expected,
		);
	});

	it('does not strip legal forms from a plain description', () => {
		expect(
			getBankTransactionMerchantKey({
				description: 'Invoice 2026 AB',
				counterpartyName: null,
				creditDebitIndicator: 'DBIT',
			}),
		).toBe('EXPENSE:invoice 2026 ab');
	});

	it('keys a structured SEPA name without its legal form', () => {
		expect(
			getBankTransactionMerchantKey({
				description:
					'SEPA iDEAL IBAN: NL91ABNA0417164300 BIC: ABNANL2A Naam: Example Shop EU SARL Omschrijving: x',
				counterpartyName: null,
				creditDebitIndicator: 'DBIT',
			}),
		).toBe('EXPENSE:example shop');
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

	it('keys processor-collected direct debits by the explicitly named legal business', () => {
		const transactions = ['Example Fitness', 'Example Music'].map((business) => ({
			description: `SEPA Incasso algemeen doorlopend Naam: Adyen N.V. Machtiging: example-mandate Omschrijving: ${business} B.V. Example City: example-invoice 03/05/26 - 31/05/26 Example plan`,
			counterpartyName: 'Adyen N.V.',
			creditDebitIndicator: 'DBIT',
		}));
		expect(transactions.map(getBankTransactionMerchantKey)).toEqual([
			'EXPENSE:example fitness',
			'EXPENSE:example music',
		]);
		for (const transaction of transactions) {
			expect(getBankTransactionMerchantKey({...transaction, counterpartyName: null})).toBe(
				getBankTransactionMerchantKey(transaction),
			);
		}
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
