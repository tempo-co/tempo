import {getBankTransactionDisplayDescription} from './bank-transaction-display';

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
