import {Repository} from 'typeorm';

import {BankAccount} from '../bank-account.entity';
import {BANK_TRANSACTION_FINANCIAL_EVENT_TYPES} from '../bank-transaction-financial-event';
import {type BankTransactionIdentityInput, assignBankTransactionStableIdentityKeys} from '../bank-transaction-identity';
import {BankTransaction} from '../bank-transaction.entity';
import {BankTransactionPersistenceService} from './bank-transaction-persistence.service';

function createInsertQueryBuilder(raw: Array<{id: string; inserted: boolean}>) {
	return {
		insert: jest.fn().mockReturnThis(),
		into: jest.fn().mockReturnThis(),
		values: jest.fn().mockReturnThis(),
		orIgnore: jest.fn().mockReturnThis(),
		orUpdate: jest.fn().mockReturnThis(),
		returning: jest.fn().mockReturnThis(),
		updateEntity: jest.fn().mockReturnThis(),
		execute: jest.fn().mockResolvedValue({raw}),
	};
}

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

	it('preserves multiple identical no-reference transactions returned in one sync', async () => {
		const service = createServiceForTransactionValues();
		const insertQueryBuilder = createInsertQueryBuilder([]);
		const repository = {
			query: jest.fn().mockResolvedValue([]),
			find: jest.fn().mockResolvedValue([]),
			createQueryBuilder: jest.fn().mockReturnValue(insertQueryBuilder),
		} as unknown as Repository<BankTransaction>;
		const transaction = {
			providerTransactionId: 'volatile-provider-id',
			amount: '12.00',
			currency: 'EUR',
			creditDebitIndicator: 'DBIT',
			bookingDate: '2026-09-01',
			description: 'Synthetic test payment',
			counterpartyName: 'Synthetic Counterparty',
		};

		await (
			service as unknown as {
				persistTransactions: (...args: unknown[]) => Promise<unknown>;
			}
		).persistTransactions(
			repository,
			{id: 'account', currency: 'EUR'} as BankAccount,
			[transaction, {...transaction, providerTransactionId: 'another-volatile-id'}],
			'Synthetic Bank',
			'enable-banking',
		);

		const persisted = insertQueryBuilder.values.mock.calls[0][0] as Array<{stableIdentityKey: string}>;
		expect(persisted).toHaveLength(2);
		expect(new Set(persisted.map(({stableIdentityKey}) => stableIdentityKey)).size).toBe(2);
	});

	it('reuses a no-reference row when mutable provider details change', async () => {
		const service = createServiceForTransactionValues();
		const insertQueryBuilder = createInsertQueryBuilder([]);
		const bankAccount = {id: 'bank-account-id', currency: 'EUR'} as BankAccount;
		const originalTransaction = {
			amount: '12.00',
			currency: 'EUR',
			creditDebitIndicator: 'DBIT',
			transactionDate: '2026-09-01',
			bookingDate: '2026-09-01',
			valueDate: '2026-09-01',
			description: 'Synthetic detail before update',
			counterpartyName: 'Synthetic counterparty before update',
		};
		const originalValue = toBankTransactionValues(
			service,
			originalTransaction,
			bankAccount as unknown as Record<string, unknown>,
		);
		const existingTransaction = {
			...originalValue,
			id: 'existing-transaction-id',
			categoryStatus: 'COMPLETED',
		};
		const repositoryFind = jest
			.fn()
			.mockResolvedValueOnce([existingTransaction])
			.mockResolvedValueOnce([{id: existingTransaction.id}]);
		const repository = {
			query: jest.fn().mockResolvedValue([]),
			find: repositoryFind,
			createQueryBuilder: jest.fn().mockReturnValue(insertQueryBuilder),
		} as unknown as Repository<BankTransaction>;
		const refreshedTransaction = {
			...originalTransaction,
			description: 'Synthetic detail after update',
			counterpartyName: 'Synthetic counterparty after update',
		};

		await (
			service as unknown as {
				persistTransactions: (...args: unknown[]) => Promise<unknown>;
			}
		).persistTransactions(repository, bankAccount, [refreshedTransaction], 'Synthetic Bank', 'enable-banking');

		expect(repositoryFind).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				where: expect.objectContaining({
					bankAccountId: bankAccount.id,
					stableIdentityGroupKey: expect.any(Object),
				}),
			}),
		);
		const persistedValues = insertQueryBuilder.values.mock.calls[0][0] as Array<Record<string, unknown>>;
		expect(persistedValues[0]).toMatchObject({
			stableIdentityKey: originalValue.stableIdentityKey,
		});
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

	it('keeps an existing exchange row out of categorization and lets a held row take a new exchange marker', async () => {
		const service = createServiceForTransactionValues();
		const insertQueryBuilder = createInsertQueryBuilder([]);
		const repositoryFind = jest.fn();
		const repository = {
			query: jest.fn().mockResolvedValue([]),
			find: repositoryFind,
			createQueryBuilder: jest.fn().mockReturnValueOnce(insertQueryBuilder),
		} as unknown as Repository<BankTransaction>;
		const bankAccount = {id: 'bank-account-id', currency: 'EUR'} as BankAccount;
		const transaction = {
			id: 'provider-transaction-id',
			providerTransactionId: 'provider-transaction-id',
			amount: '10.00',
			currency: 'EUR',
			creditDebitIndicator: 'DBIT',
			description: 'Exchanged to GBP',
		};
		const mappedValue = toBankTransactionValues(
			service,
			transaction,
			bankAccount as unknown as Record<string, unknown>,
		);
		transaction.providerTransactionId = 'changed-provider-transaction-id';
		repositoryFind
			.mockResolvedValueOnce([
				{
					...mappedValue,
					id: 'existing-transaction-id',
					categoryInputHash: 'legacy-input-hash',
					categorySource: null,
					categoryStatus: 'NOT_APPLICABLE',
					financialEventType: BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
				},
			])
			.mockResolvedValueOnce([{id: 'existing-transaction-id'}]);

		await (
			service as unknown as {
				persistTransactions: (...args: unknown[]) => Promise<unknown>;
			}
		).persistTransactions(repository, bankAccount, [transaction], 'Synthetic Bank', 'enable-banking');

		expect(repositoryFind).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				select: expect.objectContaining({financialEventType: true}),
				where: expect.objectContaining({
					bankAccountId: bankAccount.id,
					stableIdentityGroupKey: expect.any(Object),
				}),
			}),
		);
		const persistedValues = insertQueryBuilder.values.mock.calls[0][0] as Array<Record<string, unknown>>;
		expect(persistedValues[0]).toMatchObject({
			providerTransactionId: 'changed-provider-transaction-id',
			stableIdentityKey: mappedValue.stableIdentityKey,
		});
		const overwriteColumns = insertQueryBuilder.orUpdate.mock.calls[0][0] as string[];
		expect(overwriteColumns).toContain('description');
		for (const column of ['financialEventType', 'financialEventSource', 'financialEventRuleVersion']) {
			expect(overwriteColumns).not.toContain(column);
		}
		expect(insertQueryBuilder.orUpdate).toHaveBeenCalledWith(
			expect.any(Array),
			['bankAccountId', 'stableIdentityKey'],
			expect.objectContaining({
				overwriteCondition: {
					where: expect.stringContaining('EXCLUDED."stableIdentityKey" IN (:...exchangeMarkerKeys)'),
					parameters: {processingStatus: 'PROCESSING', exchangeMarkerKeys: [mappedValue.stableIdentityKey]},
				},
			}),
		);
		// The changed input hash does not send the exchange row back to the model: no reset update runs.
		expect(repository.createQueryBuilder).toHaveBeenCalledTimes(1);
	});

	it('resets stale categorization for all qualifying existing rows in one guarded update', async () => {
		const service = createServiceForTransactionValues();
		const queryBuilder = {
			insert: jest.fn().mockReturnThis(),
			into: jest.fn().mockReturnThis(),
			values: jest.fn().mockReturnThis(),
			orIgnore: jest.fn().mockReturnThis(),
			orUpdate: jest.fn().mockReturnThis(),
			returning: jest.fn().mockReturnThis(),
			updateEntity: jest.fn().mockReturnThis(),
			update: jest.fn().mockReturnThis(),
			set: jest.fn().mockReturnThis(),
			where: jest.fn().mockReturnThis(),
			andWhere: jest.fn().mockReturnThis(),
			execute: jest.fn().mockResolvedValue({raw: []}),
		};
		const bankAccount = {id: 'bank-account-id', currency: 'EUR'} as BankAccount;
		const transactions = ['Synthetic grocer', 'Synthetic cafe', 'Synthetic bakery'].map((description, index) => ({
			providerTransactionId: `provider-transaction-${index}`,
			amount: `${index + 1}.00`,
			currency: 'EUR',
			creditDebitIndicator: 'DBIT',
			bookingDate: '2026-09-01',
			description,
		}));
		const existingTransactions = transactions.map((transaction, index) => ({
			...toBankTransactionValues(service, transaction, bankAccount as unknown as Record<string, unknown>),
			id: `existing-transaction-${index}`,
			categoryInputHash: 'stale-input-hash',
			categorySource: null,
			categoryStatus: index === 2 ? 'COMPLETED' : 'FAILED',
		}));
		const repositoryFind = jest
			.fn()
			.mockResolvedValueOnce(existingTransactions)
			.mockResolvedValueOnce(existingTransactions.map(({id}) => ({id})));
		const repository = {
			query: jest.fn().mockResolvedValue([]),
			find: repositoryFind,
			createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
		} as unknown as Repository<BankTransaction>;

		await (
			service as unknown as {
				persistTransactions: (...args: unknown[]) => Promise<unknown>;
			}
		).persistTransactions(repository, bankAccount, transactions, 'Synthetic Bank', 'enable-banking');

		expect(queryBuilder.update).toHaveBeenCalledTimes(1);
		expect(queryBuilder.set).toHaveBeenCalledWith(
			expect.objectContaining({categoryStatus: 'PENDING', categoryUpdatedAt: null, category: null}),
		);
		expect(queryBuilder.where).toHaveBeenCalledWith('"bankAccountId" = :bankAccountId', {
			bankAccountId: bankAccount.id,
		});
		expect(queryBuilder.andWhere).toHaveBeenCalledWith('id IN (:...ids)', {
			ids: ['existing-transaction-0', 'existing-transaction-1'],
		});
		expect(queryBuilder.andWhere).toHaveBeenCalledWith(`"categorySource" IS DISTINCT FROM 'MANUAL'`);
		expect(queryBuilder.andWhere).toHaveBeenCalledWith('"financialEventType" IS NULL');
		expect(repository.createQueryBuilder).toHaveBeenCalledTimes(2);
	});

	it('preserves existing occurrence identities when mutable details reorder repeated-reference rows', async () => {
		const service = createServiceForTransactionValues();
		const insertQueryBuilder = createInsertQueryBuilder([]);
		const bankAccount = {id: 'bank-account-id', currency: 'EUR'} as BankAccount;
		const firstTransaction = {
			providerTransactionId: 'synthetic-row-a',
			entryReference: 'shared-entry-reference',
			amount: '12.00',
			currency: 'EUR',
			creditDebitIndicator: 'DBIT',
			transactionDate: '2026-09-01',
			bookingDate: '2026-09-01',
			valueDate: '2026-09-01',
			description: 'Alpha',
			counterpartyName: 'Synthetic Counterparty A',
			referenceNumber: 'reference-a',
		};
		const secondTransaction = {
			providerTransactionId: 'synthetic-row-b',
			entryReference: 'shared-entry-reference',
			amount: '12.00',
			currency: 'EUR',
			creditDebitIndicator: 'DBIT',
			transactionDate: '2026-09-01',
			bookingDate: '2026-09-01',
			valueDate: '2026-09-01',
			description: 'Beta',
			counterpartyName: 'Synthetic Counterparty B',
			referenceNumber: 'reference-b',
		};
		const asIdentityInput = (transaction: typeof firstTransaction | typeof secondTransaction) =>
			toBankTransactionValues(
				service,
				transaction,
				bankAccount as unknown as Record<string, unknown>,
			) as unknown as BankTransactionIdentityInput & {
				providerTransactionId: string;
			};
		const initialValues = assignBankTransactionStableIdentityKeys(
			[firstTransaction, secondTransaction].map(asIdentityInput),
		);
		const initialKeysByProviderId = new Map(
			initialValues.map(({providerTransactionId, stableIdentityKey}) => [
				providerTransactionId,
				stableIdentityKey,
			]),
		);
		const existingTransactions = initialValues.map((value, index) => ({
			...value,
			id: `existing-transaction-${index}`,
			categorySource: 'AI',
			categoryStatus: 'COMPLETED',
		}));
		const repository = {
			query: jest.fn().mockResolvedValue([]),
			find: jest
				.fn()
				.mockResolvedValueOnce(existingTransactions)
				.mockResolvedValueOnce(existingTransactions.map(({id}) => ({id}))),
			createQueryBuilder: jest.fn().mockReturnValue(insertQueryBuilder),
		} as unknown as Repository<BankTransaction>;
		const updatedFirstTransaction = {
			...firstTransaction,
			description: 'Zulu',
			counterpartyName: 'Synthetic Counterparty A Updated',
			referenceNumber: 'reference-z',
		};

		await (
			service as unknown as {
				persistTransactions: (...args: unknown[]) => Promise<unknown>;
			}
		).persistTransactions(
			repository,
			bankAccount,
			[updatedFirstTransaction, secondTransaction],
			'Synthetic Bank',
			'enable-banking',
		);

		const persistedValues = insertQueryBuilder.values.mock.calls[0][0] as Array<{
			providerTransactionId: string;
			stableIdentityKey: string;
		}>;
		expect(
			new Map(
				persistedValues.map(({providerTransactionId, stableIdentityKey}) => [
					providerTransactionId,
					stableIdentityKey,
				]),
			),
		).toEqual(initialKeysByProviderId);
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
