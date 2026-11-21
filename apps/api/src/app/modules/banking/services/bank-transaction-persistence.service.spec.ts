import {type BankTransactionIdentityInput, assignBankTransactionStableIdentityKeys} from '../bank-transaction-identity';
import {BankTransactionPersistenceService} from './bank-transaction-persistence.service';

describe('BankTransactionPersistenceService transaction event persistence', () => {
	function createServiceForTransactionValues(): BankTransactionPersistenceService {
		return new BankTransactionPersistenceService();
	}

	function toBankTransactionValues(
		service: BankTransactionPersistenceService,
		transaction: Record<string, unknown>,
		bankAccount: Record<string, unknown>,
		_provider = 'enable-banking',
		aspspName = 'Synthetic Bank',
	): BankTransactionIdentityInput & Record<string, unknown> {
		return (
			service as unknown as {
				toBankTransactionValues: (...args: unknown[]) => BankTransactionIdentityInput & Record<string, unknown>;
			}
		).toBankTransactionValues(bankAccount, transaction, aspspName);
	}

	it('uses the stable entry reference instead of a changing provider transaction ID', () => {
		const service = createServiceForTransactionValues();
		const transaction = {
			providerTransactionId: 'volatile-provider-id-a',
			entryReference: 'entry-reference.test',
			amount: '12.00',
			currency: 'EUR',
			creditDebitIndicator: 'DBIT',
			bookingDate: '2026-09-01',
			description: 'Synthetic test payment',
			counterpartyName: 'Synthetic Counterparty',
			remittanceInformation: 'Fixture reference',
		};
		const first = toBankTransactionValues(
			service,
			transaction,
			{id: 'account', currency: 'EUR'},
			'enable-banking',
			'Synthetic Bank',
		);
		const nextFetch = toBankTransactionValues(
			service,
			{...transaction, providerTransactionId: 'volatile-provider-id-b'},
			{id: 'account', currency: 'EUR'},
			'enable-banking',
			'Synthetic Bank',
		);

		expect(first.stableIdentityKey).toEqual(expect.any(String));
		expect(first.stableIdentityKey).toBe(nextFetch.stableIdentityKey);
	});

	it('keeps an entry-referenced transaction identity when mutable provider details change', () => {
		const service = createServiceForTransactionValues();
		const transaction = {
			providerTransactionId: 'volatile-provider-id-a',
			entryReference: 'stable-entry-reference',
			amount: '12.00',
			currency: 'EUR',
			creditDebitIndicator: 'DBIT',
			bookingDate: '2026-09-01',
			description: 'Synthetic detail before update',
			counterpartyName: 'Synthetic Counterparty A',
			bankTransactionDescription: 'Synthetic payment before update',
			referenceNumber: 'synthetic-reference-before',
			referenceNumberScheme: 'SYNTHETIC_A',
		};
		const first = toBankTransactionValues(service, transaction, {id: 'account', currency: 'EUR'});
		const refreshed = toBankTransactionValues(
			service,
			{
				...transaction,
				providerTransactionId: 'volatile-provider-id-b',
				description: 'Synthetic detail after update',
				counterpartyName: 'Synthetic Counterparty B',
				bankTransactionDescription: 'Synthetic payment after update',
				referenceNumber: 'synthetic-reference-after',
				referenceNumberScheme: 'SYNTHETIC_B',
			},
			{id: 'account', currency: 'EUR'},
		);

		expect(first.stableIdentityKey).toBe(refreshed.stableIdentityKey);
	});

	it('does not merge distinct transactions that share an entry reference', () => {
		const service = createServiceForTransactionValues();
		const first = toBankTransactionValues(
			service,
			{
				providerTransactionId: 'volatile-provider-id-a',
				entryReference: 'reused-entry-reference',
				amount: '12.00',
				currency: 'EUR',
				bookingDate: '2026-09-01',
				description: 'Synthetic test payment A',
			},
			{id: 'account', currency: 'EUR'},
		);
		const second = toBankTransactionValues(
			service,
			{
				providerTransactionId: 'volatile-provider-id-b',
				entryReference: 'reused-entry-reference',
				amount: '13.00',
				currency: 'EUR',
				bookingDate: '2026-09-01',
				description: 'Synthetic test payment B',
			},
			{id: 'account', currency: 'EUR'},
		);

		expect(first.stableIdentityKey).not.toBe(second.stableIdentityKey);
	});

	it.each([
		['transaction dates', 'transactionDate', '2026-08-31', '2026-09-02'],
		['bank transaction codes', 'bankTransactionCode', 'CODE_A', 'CODE_B'],
		['bank transaction subcodes', 'bankTransactionSubCode', 'SUBCODE_A', 'SUBCODE_B'],
		['bank transaction descriptions', 'bankTransactionDescription', 'Synthetic detail A', 'Synthetic detail B'],
		['merchant category codes', 'merchantCategoryCode', '1111', '2222'],
		['provider reference numbers', 'referenceNumber', 'synthetic-reference-a', 'synthetic-reference-b'],
		['provider reference schemes', 'referenceNumberScheme', 'SCHEME_A', 'SCHEME_B'],
	] as const)('does not merge transactions with different %s', (_label, field, firstValue, secondValue) => {
		const service = createServiceForTransactionValues();
		const transaction = {
			providerTransactionId: 'volatile-provider-id',
			amount: '12.00',
			currency: 'EUR',
			creditDebitIndicator: 'DBIT',
			bookingDate: '2026-09-01',
			description: 'Synthetic test payment',
		};
		const [first, second] = assignBankTransactionStableIdentityKeys([
			toBankTransactionValues(service, {...transaction, [field]: firstValue}, {id: 'account', currency: 'EUR'}),
			toBankTransactionValues(service, {...transaction, [field]: secondValue}, {id: 'account', currency: 'EUR'}),
		]);

		expect(first.stableIdentityKey).not.toBe(second.stableIdentityKey);
	});

	it('does not merge transactions with different provider locations', () => {
		const service = createServiceForTransactionValues();
		const transaction = {
			providerTransactionId: 'volatile-provider-id',
			amount: '12.00',
			currency: 'EUR',
			creditDebitIndicator: 'DBIT',
			bookingDate: '2026-09-01',
			description: 'Synthetic test payment',
			counterpartyLocation: {city: 'Synthetic City A', region: 'Synthetic Region', country: 'ZZ'},
		};
		const [first, second] = assignBankTransactionStableIdentityKeys([
			toBankTransactionValues(service, transaction, {id: 'account', currency: 'EUR'}),
			toBankTransactionValues(
				service,
				{...transaction, counterpartyLocation: {...transaction.counterpartyLocation, city: 'Synthetic City B'}},
				{id: 'account', currency: 'EUR'},
			),
		]);

		expect(first.stableIdentityKey).not.toBe(second.stableIdentityKey);
	});

	it('does not merge transactions with different instructed amounts or exchange rates', () => {
		const service = createServiceForTransactionValues();
		const transaction = {
			providerTransactionId: 'volatile-provider-id',
			amount: '12.00',
			currency: 'EUR',
			creditDebitIndicator: 'DBIT',
			bookingDate: '2026-09-01',
			description: 'Synthetic test payment',
			instructedAmount: '20.00',
			instructedCurrency: 'USD',
			exchangeRate: '1.1000',
			exchangeRateUnitCurrency: 'USD',
			exchangeRateType: 'SYNTHETIC',
		};
		const [first, differentInstructedAmount, differentExchangeRate] = assignBankTransactionStableIdentityKeys([
			toBankTransactionValues(service, transaction, {id: 'account', currency: 'EUR'}),
			toBankTransactionValues(
				service,
				{...transaction, instructedAmount: '21.00'},
				{id: 'account', currency: 'EUR'},
			),
			toBankTransactionValues(
				service,
				{...transaction, exchangeRate: '1.2000'},
				{id: 'account', currency: 'EUR'},
			),
		]);

		expect(first.stableIdentityKey).not.toBe(differentInstructedAmount.stableIdentityKey);
		expect(first.stableIdentityKey).not.toBe(differentExchangeRate.stableIdentityKey);
	});

	it('does not use provider transaction IDs as identity when no entry reference is available', () => {
		const service = createServiceForTransactionValues();
		const transaction = {
			providerTransactionId: 'volatile-provider-id-a',
			amount: '12.00',
			currency: 'EUR',
			creditDebitIndicator: 'DBIT',
			bookingDate: '2026-09-01',
			description: 'Synthetic test payment',
			counterpartyName: 'Synthetic Counterparty',
			remittanceInformation: 'Fixture reference',
		};
		const first = toBankTransactionValues(
			service,
			transaction,
			{id: 'account', currency: 'EUR'},
			'enable-banking',
			'Synthetic Bank',
		);
		const nextFetch = toBankTransactionValues(
			service,
			{...transaction, providerTransactionId: 'volatile-provider-id-b'},
			{id: 'account', currency: 'EUR'},
			'enable-banking',
			'Synthetic Bank',
		);

		const amountWithDifferentScale = toBankTransactionValues(
			service,
			{...transaction, providerTransactionId: 'volatile-provider-id-c', amount: '12.00000000'},
			{id: 'account', currency: 'EUR'},
			'enable-banking',
			'Synthetic Bank',
		);

		expect(first.stableIdentityKey).toEqual(expect.any(String));
		expect(first.stableIdentityKey).toBe(nextFetch.stableIdentityKey);
		expect(first.stableIdentityKey).toBe(amountWithDifferentScale.stableIdentityKey);
	});

	it('does not merge distinct transactions that happen to share a provider transaction ID', () => {
		const service = createServiceForTransactionValues();
		const first = toBankTransactionValues(
			service,
			{
				providerTransactionId: 'reused-provider-id',
				amount: '12.00',
				currency: 'EUR',
				creditDebitIndicator: 'DBIT',
				bookingDate: '2026-09-01',
				description: 'Synthetic test payment A',
			},
			{id: 'account', currency: 'EUR'},
		);
		const second = toBankTransactionValues(
			service,
			{
				providerTransactionId: 'reused-provider-id',
				amount: '13.00',
				currency: 'EUR',
				creditDebitIndicator: 'DBIT',
				bookingDate: '2026-09-01',
				description: 'Synthetic test payment B',
			},
			{id: 'account', currency: 'EUR'},
		);

		expect(first.stableIdentityKey).toEqual(expect.any(String));
		expect(first.stableIdentityKey).not.toBe(second.stableIdentityKey);
	});

	it('leaves currency exchange classification to the recompute and keeps the categorization input hash', () => {
		const service = createServiceForTransactionValues();
		const values = toBankTransactionValues(
			service,
			{
				id: 'provider-transaction-id',
				amount: '10.00',
				currency: 'EUR',
				creditDebitIndicator: 'DBIT',
				description: ' Exchanged   to GBP ',
			},
			{id: 'bank-account-id', currency: 'EUR'},
		);

		expect(values).not.toHaveProperty('financialEventType');
		expect(values).not.toHaveProperty('financialEventSource');
		expect(values).not.toHaveProperty('financialEventRuleVersion');
		expect(values.categoryInputHash).toEqual(expect.any(String));
	});

	it('does not classify an ordinary card payment that contains exchange metadata', () => {
		const service = createServiceForTransactionValues();
		const values = toBankTransactionValues(
			service,
			{
				id: 'provider-card-payment-id',
				amount: '10.00',
				currency: 'EUR',
				creditDebitIndicator: 'DBIT',
				description: 'Card payment',
				exchangeRate: '1.12',
				exchangeRateUnitCurrency: 'USD',
			},
			{id: 'bank-account-id', currency: 'EUR'},
		);

		expect(values).not.toHaveProperty('financialEventType');
		expect(values.categoryInputHash).toEqual(expect.any(String));
	});
});
