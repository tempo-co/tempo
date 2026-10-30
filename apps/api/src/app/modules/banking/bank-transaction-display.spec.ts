import {extractProcessorCollectedBusinessName, getBankTransactionDisplayDescription} from './bank-transaction-display';

describe('extractProcessorCollectedBusinessName', () => {
	it.each([
		'Example Fitness B.V.',
		'Example Fitness B. V.',
		'Example Fitness BV',
		'Example Music N.V.',
		'Example Music GmbH',
		'Example Music Ltd.',
		'Example Music LLC',
		'Example Music S.a r.l.',
	])('extracts the leading legal entity %s before a wordwrapped locality and reference', (businessName) => {
		const transaction = {
			description: `SEPA Incasso algemeen doorlopend Naam: Adyen N.V. Machtiging: example-ref Omschrijving: ${businessName} Exa\n mple City: example-invoice 03/05/26 - 31/05/26 plan Kenmerk: example-reference`,
			counterpartyName: null,
		};
		expect(extractProcessorCollectedBusinessName(transaction)).toBe(businessName);
		expect(getBankTransactionDisplayDescription(transaction)).toBe(businessName);
	});

	it.each([
		{
			name: 'unstructured bank notes',
			description: 'Payment note Naam: Adyen N.V. Omschrijving: Example Fitness B.V. Example City: example-ref',
		},
		{
			name: 'card payments',
			description: 'BEA, Example Card Shop,PAS123 NR:EX001 Omschrijving: Example Fitness B.V. Example City: ref',
		},
		{
			name: 'SEPA transfers and iDEAL remittances',
			description: 'SEPA iDEAL Naam: Adyen N.V. Omschrijving: Example Fitness B.V. Example City: example-ref',
		},
		{
			name: 'missing structured processor name',
			description:
				'SEPA Incasso algemeen doorlopend Omschrijving: Example Fitness B.V. Example City: example-ref',
		},
		{
			name: 'a declared nonprocessor counterparty',
			description: 'SEPA Incasso Naam: Adyen N.V. Omschrijving: Example Fitness B.V. Example City: example-ref',
			counterpartyName: 'Example Actual Business',
		},
		{
			name: 'a structured nonprocessor counterparty',
			description:
				'SEPA Incasso Naam: Example Actual Business Omschrijving: Example Fitness B.V. Example City: ref',
		},
		{
			name: 'remittance with no legal entity',
			description: 'SEPA Incasso Naam: Adyen N.V. Omschrijving: Example Fitness Example City: example-ref',
		},
		{
			name: 'invoice or date before a company',
			description: 'SEPA Incasso Naam: Adyen N.V. Omschrijving: 2026-05 Example Fitness B.V. Example City: ref',
		},
		{
			name: 'a company mentioned inside a sentence',
			description: 'SEPA Incasso Naam: Adyen N.V. Omschrijving: Plan for: Example Fitness B.V. Example City: ref',
		},
		{
			name: 'an unbounded legal entity followed by arbitrary note text',
			description: 'SEPA Incasso Naam: Adyen N.V. Omschrijving: Example Fitness B.V. payment for example plan',
		},
		{
			name: 'the processor itself in the remittance',
			description: 'SEPA Incasso Naam: Adyen N.V. Omschrijving: Adyen B.V. Example City: example-ref',
		},
	])('leaves $name unresolved', ({description, counterpartyName = 'Adyen N.V.'}) => {
		expect(extractProcessorCollectedBusinessName({description, counterpartyName})).toBeNull();
	});

	it.each([
		'Invoice Example Fitness B.V. Example City: example-ref',
		'Factuur Example Fitness B.V. Example City: example-ref',
		'Payment for Example Fitness B.V. Example City: example-ref',
		'Example Fitness B.V. and Example Music B.V. Example City: example-ref',
		'Example Fitness B.V., Example Music B.V. Example City: example-ref',
	])('leaves narrative or ambiguous remittances unresolved: %s', (remittance) => {
		const transaction = {
			description: `SEPA Incasso Naam: Adyen N.V. Omschrijving: ${remittance}`,
			counterpartyName: 'Adyen N.V.',
		};
		expect(extractProcessorCollectedBusinessName(transaction)).toBeNull();
		expect(getBankTransactionDisplayDescription(transaction)).toBe('Adyen N.V.');
	});
});

describe('getBankTransactionDisplayDescription', () => {
	it.each([
		{
			name: 'extracts a structured SEPA counterparty name',
			description:
				'SEPA iDEAL/Wero IBAN: NL00TEST0000000000 BIC: TESTNL2A Naam: Example Shop Omschrijving: order-123 Kenmerk: reference',
			counterpartyName: null,
			expected: 'Example Shop',
		},
		{
			name: 'names the legal business collected by a processor in a SEPA direct debit',
			description:
				'SEPA Incasso algemeen doorlopend Naam: Adyen N.V. Machtiging: example-mandate Omschrijving: Example Fitness B.V. Example City: example-invoice 03/05/26 - 31/05/26 Example plan',
			counterpartyName: 'Adyen N.V.',
			expected: 'Example Fitness B.V.',
		},
		{
			name: 'extracts the useful part of a Google Pay card payment',
			description: 'BEA, Google Pay Example Supermarket,PAS123 NR:ABC123, 04.09.26/19:00 CITY',
			counterpartyName: null,
			expected: 'Example Supermarket',
		},
		{
			name: 'drops Apple Pay, Betaalpas and payment-processor prefixes but keeps the terminal number',
			description: 'BEA, Apple Pay BCK*Example Rail 201,PAS123 NR:ABC123, 04.09.26/19:00 CITY',
			counterpartyName: null,
			expected: 'Example Rail 201',
		},
		{
			name: 'drops the Betaalpas prefix',
			description: 'BEA, Betaalpas CCV*Example Cafe,PAS123 NR:ABC123, 04.09.26/19:00 CITY',
			counterpartyName: null,
			expected: 'Example Cafe',
		},
		{
			name: 'drops card details written with a space after PAS',
			description: 'BEA, Google Pay Example Supermarket,PAS 123 NR:ABC123, 04.09.26/19:00 CITY',
			counterpartyName: null,
			expected: 'Example Supermarket',
		},
		{
			name: 'keeps the wallet name when a card line has no merchant',
			description: 'BEA, Google Pay,PAS123 NR:ABC123, 04.09.26/19:00 CITY',
			counterpartyName: null,
			expected: 'Google Pay',
		},
		{
			name: 'falls back to the full line when nothing is left after stripping',
			description: 'BEA, SQ*,PAS123',
			counterpartyName: null,
			expected: 'BEA, SQ*,PAS123',
		},
		{
			name: 'extracts the useful part of an ordinary card payment',
			description: 'BEA, Example Store NR:ABC123, 04.09.26/19:00 CITY',
			counterpartyName: null,
			expected: 'Example Store',
		},
		{
			name: 'extracts the useful part of a GEA card transaction',
			description: 'GEA, Example ATM NR:ABC123, 04.09.26/19:00 CITY',
			counterpartyName: null,
			expected: 'Example ATM',
		},
	])('handles $name', ({description, counterpartyName, expected}) => {
		expect(getBankTransactionDisplayDescription({description, counterpartyName})).toBe(expected);
	});

	it('prefers the counterparty name for a long unstructured description', () => {
		expect(
			getBankTransactionDisplayDescription({
				description: 'A long ordinary banking description '.repeat(3),
				counterpartyName: 'Example Counterparty',
			}),
		).toBe('Example Counterparty');
	});

	it('keeps ordinary descriptions containing parser markers unchanged', () => {
		expect(
			getBankTransactionDisplayDescription({
				description: 'Payment note: Google Pay and Naam: Example details',
				counterpartyName: null,
			}),
		).toBe('Payment note: Google Pay and Naam: Example details');
	});

	it('normalizes whitespace in ordinary descriptions', () => {
		expect(
			getBankTransactionDisplayDescription({
				description: '  Example   payment\nreference  ',
				counterpartyName: null,
			}),
		).toBe('Example payment reference');
	});

	it('uses the description at the exact fallback boundary', () => {
		const description = 'A'.repeat(80);

		expect(getBankTransactionDisplayDescription({description, counterpartyName: 'Example Counterparty'})).toBe(
			description,
		);
	});

	it('uses the counterparty after the fallback boundary', () => {
		expect(
			getBankTransactionDisplayDescription({
				description: 'A'.repeat(81),
				counterpartyName: 'Example Counterparty',
			}),
		).toBe('Example Counterparty');
	});

	it.each([
		{description: null, counterpartyName: 'Example Counterparty', expected: 'Example Counterparty'},
		{description: '   ', counterpartyName: '   ', expected: 'Transaction'},
		{description: null, counterpartyName: null, expected: 'Transaction'},
	])('handles blank values', ({description, counterpartyName, expected}) => {
		expect(getBankTransactionDisplayDescription({description, counterpartyName})).toBe(expected);
	});
});
