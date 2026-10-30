import {createBankTransaction} from '../../../../../test/fixtures/bank-transaction.fixture';
import {BankTransaction} from '../bank-transaction.entity';
import {
	createBankTransactionCategorizationInputHash,
	toBankTransactionCategorizationInput,
	toBankTransactionCategorizationWebSearchInput,
	toMerchantIdentificationName,
} from './bank-transaction-categorization-input';

// Raw provider-style values (padding, lowercase codes) so normalization is observable.
function createTransaction(overrides: Partial<BankTransaction> = {}): BankTransaction {
	return createBankTransaction({
		currency: 'eur',
		creditDebitIndicator: 'dbit',
		bankTransactionDescription: ' Card payment ',
		description: ' Coffee shop ',
		counterpartyName: ' Cafe ',
		merchantCategoryCode: '5814',
		remittanceInformation: ' Morning coffee ',
		balanceAfterAmount: '100.00',
		balanceAfterCurrency: 'EUR',
		instructedAmount: '12.50',
		instructedCurrency: 'USD',
		exchangeRate: '0.9',
		exchangeRateUnitCurrency: 'USD',
		exchangeRateType: 'SPOT',
		referenceNumber: 'reference',
		referenceNumberScheme: 'RF',
		...overrides,
	});
}

describe('bank transaction categorization input', () => {
	it('normalizes safe fields and derives direction without including identifiers', () => {
		const input = toBankTransactionCategorizationInput(createTransaction());

		expect(input).toEqual({
			correlationId: 'transaction-id',
			transactionDate: '2026-09-01',
			bookingDate: '2026-09-02',
			valueDate: '2026-09-03',
			amount: '-12.50',
			currency: 'EUR',
			creditDebitIndicator: 'DBIT',
			direction: 'EXPENSE',
			transactionType: 'CARD_PAYMENT',
			bankTransactionCode: 'PMNT',
			bankTransactionSubCode: 'CARD',
			description: 'Coffee shop',
			counterpartyName: 'Cafe',
			bankTransactionDescription: 'Card payment',
			merchantCategoryCode: '5814',
			remittanceInformation: 'Morning coffee',
		});
		expect(JSON.stringify(input)).not.toContain('provider-id');
		expect(JSON.stringify(input)).not.toContain('account-id');
	});

	it('normalizes a numeric card code when the provider omits its subcode', () => {
		const input = toBankTransactionCategorizationInput({
			...createTransaction({
				transactionType: 'OTHER',
				bankTransactionCode: '426',
				bankTransactionSubCode: null,
			}),
			aspspName: 'ABN AMRO',
		});

		expect(input.transactionType).toBe('CARD_PAYMENT');
	});

	it('does not apply a provider-specific numeric code to another ASPSP', () => {
		const input = toBankTransactionCategorizationInput({
			...createTransaction({
				transactionType: 'OTHER',
				bankTransactionCode: '426',
				bankTransactionSubCode: null,
			}),
			aspspName: 'Synthetic Bank',
		});

		expect(input.transactionType).toBe('OTHER');
	});

	it('re-derives the transaction type when the stored value is stale', () => {
		const input = toBankTransactionCategorizationInput(
			createTransaction({
				transactionType: 'TRANSFER',
				bankTransactionCode: '944',
				bankTransactionSubCode: null,
				bankTransactionDescription: null,
			}),
		);

		expect(input.transactionType).toBe('OTHER');
	});

	it('keeps the hash stable across insignificant text and case changes', () => {
		const first = createTransaction();
		const second = createTransaction({
			currency: ' EUR ',
			creditDebitIndicator: ' DBIT ',
			description: '  Coffee shop  ',
			counterpartyName: ' Cafe ',
			bankTransactionDescription: 'Card payment ',
			remittanceInformation: 'Morning coffee',
		});

		expect(createBankTransactionCategorizationInputHash(first)).toBe(
			createBankTransactionCategorizationInputHash(second),
		);
	});

	it('keeps the hash stable across database numeric scale normalization', () => {
		expect(createBankTransactionCategorizationInputHash(createTransaction({amount: '2.50'}))).toBe(
			createBankTransactionCategorizationInputHash(createTransaction({amount: '2.50000000'})),
		);
	});

	it('does not change the hash when only the stored type is stale', () => {
		expect(createBankTransactionCategorizationInputHash(createTransaction())).toBe(
			createBankTransactionCategorizationInputHash(createTransaction({transactionType: 'TRANSFER'})),
		);
	});

	it.each([
		['amount', {amount: '-12.51'}],
		['direction indicator', {creditDebitIndicator: 'CRDT'}],
		['bank transaction code', {bankTransactionCode: 'PMNT2'}],
		['bank transaction sub-code', {bankTransactionSubCode: 'CARD2'}],
		['transaction date', {transactionDate: '2026-09-04'}],
		['booking date', {bookingDate: '2026-09-04'}],
		['value date', {valueDate: '2026-09-04'}],
		['description', {description: 'Different description'}],
		['counterparty', {counterpartyName: 'Different counterparty'}],
		['bank transaction description', {bankTransactionDescription: 'Different bank description'}],
		['merchant category code', {merchantCategoryCode: '5999'}],
		['remittance information', {remittanceInformation: 'Different remittance'}],
		['merchant location', {merchantLocation: {city: 'Differenttown', region: 'Different Region', country: 'BE'}}],
	])('changes the hash when %s changes', (_field, override) => {
		expect(createBankTransactionCategorizationInputHash(createTransaction())).not.toBe(
			createBankTransactionCategorizationInputHash(createTransaction(override as Partial<BankTransaction>)),
		);
	});

	it('does not hash excluded financial and provider identity fields', () => {
		const first = createTransaction();
		const second = createTransaction({
			balanceAfterAmount: '999.00',
			instructedAmount: '99.00',
			exchangeRate: '1.2',
			referenceNumber: 'different-reference',
			bankAccountId: 'different-account',
			providerTransactionId: 'different-provider-id',
			entryReference: 'different-entry',
		});

		expect(createBankTransactionCategorizationInputHash(first)).toBe(
			createBankTransactionCategorizationInputHash(second),
		);
	});

	it('caps remittance information at 2,000 characters', () => {
		const remittanceInformation = 'x'.repeat(2_500);
		const input = toBankTransactionCategorizationInput(createTransaction({remittanceInformation}));

		expect(input.remittanceInformation).toHaveLength(2_000);
		expect(input.remittanceInformation).toBe(remittanceInformation.slice(0, 2_000));
	});

	it('redacts high-risk remittance identifiers before provider use', () => {
		const input = toBankTransactionCategorizationInput(
			createTransaction({
				remittanceInformation: 'IBAN NL00 TEST 0000 0000 00 contact test@example.com NR:ABC123456 1234567',
			}),
		);

		expect(input.remittanceInformation).toBe('IBAN [REDACTED] contact [REDACTED] NR:[REDACTED]');
	});

	it('redacts identifiers from all provider-bound text while preserving useful category context', () => {
		const input = toBankTransactionCategorizationInput(
			createTransaction({
				description:
					'SEPA card purchase at Example Corner Shop in 2024. 020 000 0000. IBAN: NL00 TEST 0000 0000 00 BIC: TESTXX00 Ref: TXN-20260918-ABCD abc0123456789def01 0f1e2d3c4b5a69 9876543210987654 Order Jouw bestelling 424242 https://shop.example/orders/123456?token=sample-token sales@example.test',
				counterpartyName:
					'Example Hardware Store Card: 9999 999999 99999 Account no: 1234/5678/90 Reference number: QZXB 2345.6789.77 Ref: ABCD 1234 Reference: AB12 3456 Reference number: 1234 AB12 Reference: 1234/ABCD.Reference number: 5678 Reference: 9876/ABCD-XYZ',
				bankTransactionDescription: 'Retail purchase account NL00 TEST 0000 0000 00',
				remittanceInformation: 'Invoice 1234567 phone +1 202-555-0100 Mandate: MND123',
			}),
		);
		const serializedText = JSON.stringify({
			description: input.description,
			counterpartyName: input.counterpartyName,
			bankTransactionDescription: input.bankTransactionDescription,
			remittanceInformation: input.remittanceInformation,
		});

		expect(input.description).toContain('SEPA card purchase at Example Corner Shop in 2024');
		expect(input.description).toContain('Order Jouw bestelling');
		expect(input.description).toContain('shop.example');
		expect(input.counterpartyName).toContain('Example Hardware Store');
		expect(input.counterpartyName).toContain('Card: [REDACTED]');
		expect(input.counterpartyName).toContain('Account no: [REDACTED]');
		expect(input.counterpartyName).toContain('Reference number: [REDACTED]');
		expect(input.counterpartyName).toContain('Ref: [REDACTED]');
		expect(input.counterpartyName).toContain('Reference: [REDACTED]');
		expect(input.counterpartyName).toContain('Reference: [REDACTED].Reference number: [REDACTED]');
		expect(input.bankTransactionDescription).toContain('Retail purchase');
		expect(input.remittanceInformation).toContain('Invoice');
		expect(serializedText).not.toMatch(
			/NL00|TESTXX00|TXN-20260918-ABCD|abc0123456789def01|0f1e2d3c4b5a69|9876543210987654|424242|1234567|123456|sample-token|sales@example\.test|\+1 202-555-0100|MND123|020 000 0000|0000|000000|9999|999999|1234|5678|90|2345|6789|77|QZXB|ABCD|AB12|3456|9876|XYZ/,
		);
		expect(input.amount).toBe('-12.50');
		expect(input.transactionDate).toBe('2026-09-01');
		expect(input.bankTransactionCode).toBe('PMNT');
		expect(input.merchantCategoryCode).toBe('5814');
	});

	it('keeps a merchant word glued to a reference and redacts the reference', () => {
		const input = toBankTransactionCategorizationInput(
			createTransaction({
				description: 'Omschrijving: ExampleRFID000111222 XYZ Kenmerk: RFID000111222XYZ',
				remittanceInformation: 'ExampleREF-0012-3456 refund',
			}),
		);

		expect(input.description).toBe('Omschrijving: Example [REDACTED] XYZ Kenmerk: [REDACTED]');
		expect(input.remittanceInformation).toBe('Example [REDACTED] refund');
	});

	it.each(['abc5123456789def01', 'Ab5123456789CDEF', 'TXN-20260918-ABCD', 'Example5511223344aa', 'Abc123DEF456'])(
		'redacts the whole opaque identifier %s when no merchant word leads it',
		(identifier) => {
			const input = toBankTransactionCategorizationInput(
				createTransaction({description: `Payment ${identifier}`}),
			);

			expect(input.description).toBe('Payment [REDACTED]');
		},
	);

	it('does not hash changes to redacted transaction references', () => {
		expect(
			createBankTransactionCategorizationInputHash(createTransaction({description: 'Coffee order 1234567'})),
		).toBe(createBankTransactionCategorizationInputHash(createTransaction({description: 'Coffee order 7654321'})));
	});

	it('treats malformed merchant category codes as absent evidence', () => {
		const input = toBankTransactionCategorizationInput(createTransaction({merchantCategoryCode: 'not-an-mcc'}));

		expect(input.merchantCategoryCode).toBeNull();
	});

	it('keeps only compact transaction context and the selected merchant name', () => {
		const input = toBankTransactionCategorizationInput(
			createTransaction({
				amount: '-39.99',
				currency: 'EUR',
				creditDebitIndicator: 'DBIT',
				bankTransactionCode: null,
				bankTransactionSubCode: null,
				counterpartyName: 'Example Merchant via Payment Service',
				merchantCategoryCode: null,
				description: 'SEPA iDEAL IBAN: NL00TEST0123456789 Order 123456789',
				remittanceInformation: 'Order 123456789',
			}),
		);

		const result = toBankTransactionCategorizationWebSearchInput(input);

		expect(result).toEqual({
			correlationId: 'transaction-id',
			amount: '-39.99',
			currency: 'EUR',
			direction: 'EXPENSE',
			transactionType: 'OTHER',
			merchantName: 'Example Merchant via Payment Service',
			merchantLocation: null,
			searchQuery: 'Example Merchant via Payment Service',
			merchantCategoryCode: null,
		});

		const serialized = JSON.stringify(result);
		expect(serialized).not.toContain('NL00TEST0123456789');
		expect(serialized).not.toContain('123456789');
		expect(serialized).not.toContain('provider-id');
		expect(serialized).not.toContain('account-id');
		expect(serialized).not.toContain('Order 123456789');
	});

	it('preserves only a safe upstream merchant location for web search', () => {
		const input = toBankTransactionCategorizationInput(
			Object.assign(createTransaction({counterpartyName: 'Example Merchant', description: null}), {
				merchantLocation: {
					city: ' Exampletown ',
					region: ' Example Region ',
					country: 'nl',
					streetName: 'Private Street',
					postCode: '9999 ZZ',
				},
			}),
		);

		expect(input.merchantLocation).toEqual({city: 'Exampletown', region: 'Example Region', country: 'NL'});

		expect(toBankTransactionCategorizationWebSearchInput(input)).toEqual({
			correlationId: 'transaction-id',
			amount: '-12.50',
			currency: 'EUR',
			direction: 'EXPENSE',
			transactionType: 'CARD_PAYMENT',
			merchantName: 'Example Merchant',
			merchantLocation: 'Exampletown Example Region NL',
			approximateLocation: {city: 'Exampletown', region: 'Example Region', country: 'NL'},
			searchQuery: 'Example Merchant Exampletown Example Region NL',
			merchantCategoryCode: '5814',
		});
	});

	it('canonicalizes Google Pay card descriptions before web search', () => {
		const input = toBankTransactionCategorizationInput(
			createTransaction({
				counterpartyName: null,
				description: 'BEA, Google Pay Example Coffee Shop,PAS999 NR:TEST12345, 12.03.26/20:53 Sampletown',
			}),
		);

		expect(toBankTransactionCategorizationWebSearchInput(input)).toMatchObject({
			merchantName: 'Example Coffee Shop',
			merchantLocation: 'Sampletown',
			searchQuery: 'Example Coffee Shop Sampletown',
		});
	});

	it('separates the merchant and location from a noisy Example Vending Cafe card description', () => {
		const input = toBankTransactionCategorizationInput(
			createTransaction({
				counterpartyName: null,
				description: 'BEA, Google Pay Example Vending Cafe,PAS999 NR:TEST12345, 04.09.26/19:00 TESTVILLE',
			}),
		);

		expect(toBankTransactionCategorizationWebSearchInput(input)).toMatchObject({
			merchantName: 'Example Vending Cafe',
			merchantLocation: 'TESTVILLE',
			searchQuery: 'Example Vending Cafe TESTVILLE',
		});
	});

	it('keeps the location when a counterparty name is present', () => {
		const input = toBankTransactionCategorizationInput(
			createTransaction({
				counterpartyName: 'Example Vending Cafe',
				description: 'BEA, Google Pay Example Vending Cafe,PAS999 NR:TEST12345, 04.09.26/19:00 TESTVILLE',
			}),
		);

		expect(toBankTransactionCategorizationWebSearchInput(input)).toMatchObject({
			merchantName: 'Example Vending Cafe',
			merchantLocation: 'TESTVILLE',
			searchQuery: 'Example Vending Cafe TESTVILLE',
		});
	});

	it('separates the location from the Example Vending Cafe - Lobby card merchant', () => {
		const input = toBankTransactionCategorizationInput(
			createTransaction({
				counterpartyName: null,
				description:
					'BEA, Google Pay Example Vending Cafe - Lobby,PAS999 NR:TEST12345, 04.09.26/19:00 TESTVILLE',
			}),
		);

		expect(toBankTransactionCategorizationWebSearchInput(input)).toMatchObject({
			merchantName: 'Example Vending Cafe - Lobby',
			merchantLocation: 'TESTVILLE',
			searchQuery: 'Example Vending Cafe - Lobby TESTVILLE',
		});
	});

	it('uses a bare merchant as the query when no location is available', () => {
		const input = toBankTransactionCategorizationInput(
			createTransaction({counterpartyName: 'Example Merchant', description: null}),
		);

		expect(toBankTransactionCategorizationWebSearchInput(input)).toMatchObject({
			merchantName: 'Example Merchant',
			merchantLocation: null,
			searchQuery: 'Example Merchant',
		});
	});

	it('preserves a payment-domain merchant identity for web search', () => {
		const input = toBankTransactionCategorizationInput(
			createTransaction({
				counterpartyName: null,
				description: 'Www.payment.examplefitness',
				bankTransactionDescription: null,
			}),
		);

		expect(toBankTransactionCategorizationWebSearchInput(input)).toMatchObject({
			merchantName: 'examplefitness',
			merchantLocation: null,
			searchQuery: 'examplefitness',
		});
	});

	it('does not preserve numeric payment-domain identifiers for web search', () => {
		const input = toBankTransactionCategorizationInput(
			createTransaction({
				counterpartyName: null,
				description: 'Www.payment.123456789',
				bankTransactionDescription: null,
			}),
		);

		const result = toBankTransactionCategorizationWebSearchInput(input);

		expect(result).toBeNull();
	});

	it('prefers a nonblank counterparty over a noisy card description', () => {
		const input = toBankTransactionCategorizationInput(
			createTransaction({
				counterpartyName: 'Known Merchant',
				description: 'BEA, Google Pay Example Coffee Shop,PAS999 NR:TEST12345, 12.03.26/20:53 Sampletown',
			}),
		);

		expect(toBankTransactionCategorizationWebSearchInput(input)?.merchantName).toBe('Known Merchant');
	});

	it('does not search the web for a card line whose merchant is only a card tap identifier', () => {
		const input = toBankTransactionCategorizationInput(
			createTransaction({
				counterpartyName: null,
				description: 'BEA, Google Pay NLOVABCDEFGHIJKL12,PAS999 NR:TEST12345, 12.03.26/20:53 transit.example',
			}),
		);

		expect(toBankTransactionCategorizationWebSearchInput(input)).toBeNull();
	});

	it.each(['PLAYSTATION5', 'MEDIAMARKT12'])(
		'searches a one-word merchant name with a store number (%s)',
		(counterpartyName) => {
			const input = toBankTransactionCategorizationInput(
				createTransaction({counterpartyName, description: null}),
			);

			expect(toBankTransactionCategorizationWebSearchInput(input)?.merchantName).toBe(counterpartyName);
		},
	);

	it('falls back to the bank transaction description when the description is missing', () => {
		const input = toBankTransactionCategorizationInput(
			createTransaction({
				counterpartyName: null,
				description: null,
				bankTransactionDescription: 'Fallback Merchant',
			}),
		);

		expect(toBankTransactionCategorizationWebSearchInput(input)?.merchantName).toBe('Fallback Merchant');
	});

	it.each(['Google Pay', 'Apple Pay', 'Bancontact', 'ACH', 'SEPA Wero'])(
		'does not depend on a locale-specific payment-prefix list for %s',
		(paymentPrefix) => {
			const result = toBankTransactionCategorizationWebSearchInput(
				toBankTransactionCategorizationInput(
					createTransaction({
						counterpartyName: `${paymentPrefix} ACME email@example.com IBAN NL00TEST0123456789 Order 123456789 Transitville 1234`,
					}),
				),
			);

			expect(result?.merchantName).toBe(`${paymentPrefix} ACME Transitville`);
			expect(JSON.stringify(result)).not.toMatch(/email@example\.com|NL00TEST0123456789|123456789|1234/);
		},
	);

	it.each([
		['unlabelled alphanumeric references', 'ACME invoice ABC123456', 'ACME'],
		['short unlabelled mixed identifiers', 'ACME C12345', 'ACME'],
		['URLs', 'ACME https://example.com/invoices/ABC123456', 'ACME'],
		['domains', 'ACME merchant.example.com', 'ACME'],
		['formatted phone identifiers', 'ACME +31 (0)6 1234 5678', 'ACME'],
		['formatted account identifiers', 'ACME 1234-5678-9012', 'ACME'],
		['underscore-delimited identifiers', 'ACME_123456', undefined],
		['underscore-delimited IBAN', 'ACME NL00_TEST_0000_0000_00', 'ACME'],
		['short labeled numeric identifiers', 'ACME Order 123', 'ACME'],
		['short labeled ID references', 'ACME ID ABC12', 'ACME'],
		['short labeled invoice references', 'ACME invoice AB12', 'ACME'],
		['underscore-separated identifiers', 'ACME order_ABC123', 'ACME'],
		['short labeled mixed identifiers', 'ACME ref: ABC12', 'ACME'],
		['ordinary numeric brand tokens', '4Q Store', '4Q Store'],
		['ordinary hyphenated brand tokens', '7-Example', '7-Example'],
	] as const)('removes %s from web-search merchant names', (_case, counterpartyName, expected) => {
		const result = toBankTransactionCategorizationWebSearchInput(
			toBankTransactionCategorizationInput(createTransaction({counterpartyName})),
		);

		expect(result?.merchantName).toBe(expected);
	});

	it('returns null when all merchant text is empty or redacted', () => {
		const input = toBankTransactionCategorizationInput(
			createTransaction({
				counterpartyName: '',
				description: 'IBAN NL00TEST0123456789 Order 123456789',
				bankTransactionDescription: 'Card payment',
			}),
		);

		expect(toBankTransactionCategorizationWebSearchInput(input)).toBeNull();
	});

	it.each([
		['Example-shop.com', null, 'Example-shop.com'],
		['www.example-shop.com/orders/ABC123456 via Example Pay', null, 'example-shop.com via Example Pay'],
		['pay.example-gym.test via Example Pay', null, 'pay.example-gym.test via Example Pay'],
		['Example Shop, mail info@example-shop.test ref 12345678', null, 'Example Shop mail'],
		// A processor's direct debit names the business it collects for, as the merchant key and display name do.
		[
			'SEPA Incasso algemeen doorlopend Incassant: NL00ZZZ000000000000 Naam: Buckaroo Stichting Derdengelden Machtiging: example-ref Omschrijving: Example Fitness B.V. Example City: 2026-12345',
			'Buckaroo Stichting Derde',
			'Example Fitness B.V.',
		],
	])('names a merchant %j (counterparty %j) for identification as %j', (description, counterpartyName, name) => {
		const input = toBankTransactionCategorizationInput(
			createTransaction({counterpartyName, description, bankTransactionDescription: null}),
		);
		expect(toMerchantIdentificationName(input)).toBe(name);
	});
});
