import {INestApplication} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {Server} from 'node:net';
import TestAgent from 'supertest/lib/agent';
import {Repository} from 'typeorm';

import {ConfigurationService} from '@core/config/config.service';
import {Account} from '@modules/account/account.entity';
import {AccountService} from '@modules/account/account.service';
import {BankAccount} from '@modules/banking/bank-account.entity';
import {BankConnection} from '@modules/banking/bank-connection.entity';
import {BANK_TRANSACTION_CASH_FLOW_TREATMENTS} from '@modules/banking/bank-transaction-financial-event';
import {BankTransaction} from '@modules/banking/bank-transaction.entity';
import {ClaudeBankTransactionCategorizationProvider} from '@modules/banking/categorization/providers/claude-bank-transaction-categorization.provider';
import {OwnTransferService} from '@modules/banking/services/own-transfer.service';

import {BankingFixtures, CURRENCY_EXCHANGE_EVENT, bookedRow} from '../../../scripts/seed-data/banking-fixtures';
import {
	SESSION_TEST_ACCOUNT_EMAIL,
	SESSION_TEST_ACCOUNT_PASSWORD,
	VERIFIED_ACCOUNT_EMAIL,
	VERIFIED_ACCOUNT_PASSWORD,
} from '../../../scripts/seed-data/seed.constants';
import {getApp, loginAgent} from '../../setup/e2e.setup';

describe('BankTransactionController', () => {
	let app: INestApplication;
	let httpServer: Server;
	let verifiedAgent: TestAgent;
	let otherVerifiedAgent: TestAgent;
	let account: Account;
	let fixtures: BankingFixtures;
	let bankConnectionRepository: Repository<BankConnection>;
	let bankTransactionRepository: Repository<BankTransaction>;
	let fixtureConnection: BankConnection;
	let fixtureBankAccount: BankAccount;
	let fixtureTransaction: BankTransaction;
	let fixtureGroceriesTransaction: BankTransaction;
	let fixtureReviewTransaction: BankTransaction;
	let categorizeSpy: jest.SpyInstance;
	let categorizeWithWebSearchSpy: jest.SpyInstance;

	beforeAll(async () => {
		app = getApp();
		httpServer = app.getHttpServer();
		expect(app.get(ConfigurationService).get('AI_CATEGORIZATION_ENABLED')).toBe(false);
		expect(app.get(ConfigurationService).get('AI_CATEGORIZATION_WEB_SEARCH_ENABLED')).toBe(false);
		categorizeSpy = jest.spyOn(app.get(ClaudeBankTransactionCategorizationProvider), 'categorize');
		categorizeWithWebSearchSpy = jest.spyOn(
			app.get(ClaudeBankTransactionCategorizationProvider),
			'categorizeWithWebSearch',
		);
		const accountService = app.get(AccountService);
		const seededAccount = await accountService.findByEmail(VERIFIED_ACCOUNT_EMAIL);
		if (!seededAccount) throw new Error('Verified test account was not seeded.');
		account = seededAccount;

		fixtures = new BankingFixtures(app);
		bankConnectionRepository = fixtures.connections;
		bankTransactionRepository = fixtures.transactions;

		verifiedAgent = await loginAgent(httpServer, VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);
		otherVerifiedAgent = await loginAgent(httpServer, SESSION_TEST_ACCOUNT_EMAIL, SESSION_TEST_ACCOUNT_PASSWORD);

		await bankConnectionRepository
			.createQueryBuilder()
			.delete()
			.where('accountId = :accountId', {accountId: account.id})
			.execute();

		fixtureConnection = await fixtures.createConnection(account, {
			providerSessionId: 'provider-session-must-not-leak',
		});
		fixtureBankAccount = await fixtures.createBankAccount(fixtureConnection, {
			providerAccountId: 'provider-account-must-not-leak',
			identificationHash: 'identification-hash-must-not-leak',
			alias: 'Daily spending',
		});
		const secondBankAccount = await fixtures.createBankAccount(fixtureConnection, {name: 'Savings account'});

		const transactions = await fixtures.createTransactions(fixtureBankAccount, [
			{
				providerTransactionId: 'provider-transaction-coffee',
				entryReference: 'provider-entry-coffee',
				bookingDate: '2026-08-26',
				valueDate: '2026-08-26',
				amount: '-4.50',
				amountInBaseCurrency: '-4.50',
				transactionDate: '2026-08-24',
				transactionType: 'CARD_PAYMENT',
				bankTransactionCode: 'PMNT',
				bankTransactionSubCode: 'CARD',
				bankTransactionDescription: 'Card payment',
				description: 'Coffee shop',
				counterpartyName: 'Cafe',
				merchantCategoryCode: '5814',
				remittanceInformation: 'Morning coffee',
				balanceAfterAmount: '100.50',
				balanceAfterCurrency: 'EUR',
				instructedAmount: '4.50',
				instructedCurrency: 'USD',
				exchangeRate: '0.9234',
				exchangeRateUnitCurrency: 'USD',
				exchangeRateType: 'SPOT',
				referenceNumber: 'reference-coffee',
				referenceNumberScheme: 'RF',
			},
			{
				bookingDate: '2026-08-25',
				valueDate: '2026-08-25',
				amount: '-30.00',
				amountInBaseCurrency: '-30.00',
				description: 'Groceries',
				counterpartyName: 'Market',
				merchantCategoryCode: '5411',
				remittanceInformation: 'Weekly groceries',
			},
			{
				bookingDate: '2026-08-20',
				valueDate: '2026-08-20',
				amount: '100.00',
				amountInBaseCurrency: '100.00',
				creditDebitIndicator: 'CRDT',
				description: 'Salary',
				counterpartyName: 'Employer',
				remittanceInformation: 'Monthly income',
			},
		]);
		await fixtures.createTransaction(secondBankAccount, {
			bookingDate: '2026-08-10',
			valueDate: '2026-08-10',
			amount: '20.00',
			amountInBaseCurrency: '20.00',
			creditDebitIndicator: 'CRDT',
			description: 'Transfer',
			counterpartyName: 'Savings',
			remittanceInformation: 'Reserve',
		});
		fixtureTransaction = transactions[0];
		fixtureGroceriesTransaction = transactions[1];
		fixtureReviewTransaction = transactions[2];
	});

	afterAll(async () => {
		await bankConnectionRepository
			.createQueryBuilder()
			.delete()
			.where('accountId = :accountId', {accountId: account.id})
			.execute();
	});

	it('lists owner-scoped transactions with safe source metadata', async () => {
		const response = await verifiedAgent.get('/bank-transactions').expect(200);

		expect(response.body.total).toBe(4);
		expect(categorizeSpy).not.toHaveBeenCalled();
		expect(categorizeWithWebSearchSpy).not.toHaveBeenCalled();
		expect(response.body.transactions[0]).toMatchObject({
			id: fixtureTransaction.id,
			transactionDate: '2026-08-24',
			bookingDate: '2026-08-26',
			amount: '-4.50000000',
			direction: 'EXPENSE',
			transactionType: 'CARD_PAYMENT',
			providerTransactionDescription: 'Card payment',
			category: null,
			categoryStatus: 'PENDING',
			categorySource: null,
			categoryConfidence: null,
			balanceAfterAmount: '100.50000000',
			balanceAfterCurrency: 'EUR',
			instructedAmount: '4.50000000',
			instructedCurrency: 'USD',
			exchangeRate: '0.923400000000000000',
			exchangeRateUnitCurrency: 'USD',
			exchangeRateType: 'SPOT',
			referenceNumber: 'reference-coffee',
			referenceNumberScheme: 'RF',
			bankName: 'ABN AMRO',
			bankCountry: 'NL',
			bankAccountName: 'Main account',
			bankAccountAlias: 'Daily spending',
		});
		const serializedResponse = JSON.stringify(response.body);
		expect(serializedResponse).not.toContain('provider-transaction-coffee');
		expect(serializedResponse).not.toContain('provider-entry-coffee');
		expect(serializedResponse).not.toContain('identification-hash-must-not-leak');
		expect(serializedResponse).not.toContain('provider-account-must-not-leak');
		expect(response.body.transactions[0]).not.toHaveProperty('bankAccountId');
		expect(response.body.transactions[0]).not.toHaveProperty('dedupeKey');
		expect(response.body.transactions[0]).not.toHaveProperty('bankTransactionCode');
		expect(response.body.transactions[0]).not.toHaveProperty('bankTransactionSubCode');
	});

	it('uses default pagination and preserves the full total across pages', async () => {
		const additionalTransactions = await fixtures.createTransactions(
			fixtureBankAccount,
			Array.from({length: 8}, (_, index) => ({
				bookingDate: '2026-08-01',
				valueDate: '2026-08-01',
				amount: '1.00',
				creditDebitIndicator: 'CRDT',
				description: `Default pagination transaction ${index}`,
			})),
		);

		try {
			const response = await verifiedAgent.get('/bank-transactions').expect(200);

			expect(response.body.total).toBe(12);
			expect(response.body.transactions).toHaveLength(10);
			expect(response.body.transactions[0]).toMatchObject({
				id: fixtureTransaction.id,
				bookingDate: '2026-08-26',
			});

			const firstPageIds = response.body.transactions.map(({id}: {id: string}) => id);
			const nextPageResponse = await verifiedAgent
				.get('/bank-transactions')
				.query({'pagination[pageIndex]': '1'})
				.expect(200);
			const nextPageIds = nextPageResponse.body.transactions.map(({id}: {id: string}) => id);

			expect(nextPageResponse.body.total).toBe(12);
			expect(nextPageResponse.body.transactions).toHaveLength(2);
			expect(new Set([...firstPageIds, ...nextPageIds]).size).toBe(12);
			expect(
				nextPageResponse.body.transactions.every(
					({bookingDate}: {bookingDate: string}) => bookingDate === '2026-08-01',
				),
			).toBe(true);
		} finally {
			await bankTransactionRepository.remove(additionalTransactions);
		}
	});

	it('supports pagination and sorting', async () => {
		const paginatedResponse = await verifiedAgent
			.get('/bank-transactions')
			.query({
				'pagination[pageIndex]': '0',
				'pagination[pageSize]': '10',
				'sort[by]': 'amount',
				'sort[order]': 'ASC',
			})
			.expect(200);

		expect(paginatedResponse.body.total).toBe(4);
		expect(paginatedResponse.body.transactions).toHaveLength(4);
		expect(paginatedResponse.body.transactions[0].amount).toBe('-30.00000000');

		const bookingDateAscendingResponse = await verifiedAgent
			.get('/bank-transactions')
			.query({
				'pagination[pageIndex]': '0',
				'pagination[pageSize]': '10',
				'sort[by]': 'bookingDate',
				'sort[order]': 'ASC',
			})
			.expect(200);

		expect(bookingDateAscendingResponse.body.transactions[0].bookingDate).toBe('2026-08-10');
	});

	it('sorts mixed currencies by normalized amount before pagination', async () => {
		const sortingTransactions = await fixtures.createTransactions(
			fixtureBankAccount,
			[
				['RON', '100.00'],
				['EUR', '30.00'],
				['USD', '1.00'],
			].map(([currency, amount]) => ({
				providerTransactionId: `currency-sort-${currency}`,
				bookingDate: '2026-08-01',
				valueDate: '2026-08-01',
				amount,
				currency,
				creditDebitIndicator: 'CRDT',
				description: `Currency sort ${currency}`,
			})),
		);

		try {
			await bankTransactionRepository.query(
				`UPDATE "bank_transactions"
				 SET "amountInBaseCurrency" = CASE "providerTransactionId"
				   WHEN 'currency-sort-RON' THEN 20.00
				   WHEN 'currency-sort-EUR' THEN 30.00
				 END
				 WHERE "id" IN ($1, $2, $3)`,
				sortingTransactions.map(({id}) => id),
			);

			const ascendingResponse = await verifiedAgent
				.get('/bank-transactions')
				.query({
					'pagination[pageIndex]': '0',
					'pagination[pageSize]': '10',
					'filter[search]': 'Currency sort',
					'sort[by]': 'amount',
					'sort[order]': 'ASC',
				})
				.expect(200);

			expect(ascendingResponse.body.transactions.map(({id}: {id: string}) => id)).toEqual([
				sortingTransactions[0].id,
				sortingTransactions[1].id,
				sortingTransactions[2].id,
			]);

			const descendingResponse = await verifiedAgent
				.get('/bank-transactions')
				.query({
					'pagination[pageIndex]': '0',
					'pagination[pageSize]': '10',
					'filter[search]': 'Currency sort',
					'sort[by]': 'amount',
					'sort[order]': 'DESC',
				})
				.expect(200);
			expect(descendingResponse.body.transactions.map(({id}: {id: string}) => id)).toEqual([
				sortingTransactions[1].id,
				sortingTransactions[0].id,
				sortingTransactions[2].id,
			]);
		} finally {
			await bankTransactionRepository.remove(sortingTransactions);
		}
	});

	it('supports category and source sorting', async () => {
		const sourceConnection = await fixtures.createConnection(account, {aspspName: 'ING'});
		const sourceBankAccount = await fixtures.createBankAccount(sourceConnection, {name: 'Other account'});
		await fixtures.createTransaction(sourceBankAccount, {
			bookingDate: '2026-08-27',
			valueDate: '2026-08-27',
			amount: '1.00',
			creditDebitIndicator: 'CRDT',
			description: 'Source sort transaction',
		});
		await bankTransactionRepository.update({id: fixtureTransaction.id}, {category: 'FOOD_AND_DRINK'});
		await bankTransactionRepository.update({id: fixtureGroceriesTransaction.id}, {category: 'SHOPPING'});

		try {
			const categoryAscendingResponse = await verifiedAgent
				.get('/bank-transactions')
				.query({'sort[by]': 'category', 'sort[order]': 'ASC'})
				.expect(200);
			expect(
				categoryAscendingResponse.body.transactions
					.slice(0, 2)
					.map(({category}: {category: string}) => category),
			).toEqual(['FOOD_AND_DRINK', 'SHOPPING']);

			const categoryDescendingResponse = await verifiedAgent
				.get('/bank-transactions')
				.query({'sort[by]': 'category', 'sort[order]': 'DESC'})
				.expect(200);
			expect(
				categoryDescendingResponse.body.transactions
					.slice(0, 2)
					.map(({category}: {category: string}) => category),
			).toEqual(['SHOPPING', 'FOOD_AND_DRINK']);

			const sourceAscendingResponse = await verifiedAgent
				.get('/bank-transactions')
				.query({'sort[by]': 'source', 'sort[order]': 'ASC'})
				.expect(200);
			expect(sourceAscendingResponse.body.transactions[0].bankName).toBe('ABN AMRO');
			expect(sourceAscendingResponse.body.transactions.at(-1).bankName).toBe('ING');

			const sourceDescendingResponse = await verifiedAgent
				.get('/bank-transactions')
				.query({'sort[by]': 'source', 'sort[order]': 'DESC'})
				.expect(200);
			expect(sourceDescendingResponse.body.transactions[0].bankName).toBe('ING');
		} finally {
			await bankTransactionRepository.update({id: fixtureTransaction.id}, {category: null});
			await bankTransactionRepository.update({id: fixtureGroceriesTransaction.id}, {category: null});
			await bankConnectionRepository.delete(sourceConnection.id);
		}
	});

	it('applies date, account, and search filters', async () => {
		const filteredResponse = await verifiedAgent
			.get('/bank-transactions')
			.query({
				'filter[bookingDate][from]': '2026-08-21',
				'filter[bookingDate][to]': '2026-08-26',
				'filter[bankAccountIds][]': fixtureBankAccount.id,
				'filter[search]': 'coffee',
			})
			.expect(200);

		expect(filteredResponse.body.total).toBe(1);
		expect(filteredResponse.body.transactions[0].description).toBe('Coffee shop');

		const longSearchText = 'Example long transaction remittance '.padEnd(1000, 'x');
		const longSearchTransaction = await fixtures.createTransaction(fixtureBankAccount, {
			bookingDate: '2026-08-25',
			description: 'Example long-search transaction',
			remittanceInformation: longSearchText,
		});

		try {
			const longSearchResponse = await verifiedAgent
				.get('/bank-transactions')
				.query({'filter[search]': longSearchText})
				.expect(200);

			expect(longSearchResponse.body.total).toBe(1);
			expect(longSearchResponse.body.transactions).toEqual([
				expect.objectContaining({id: longSearchTransaction.id, remittanceInformation: longSearchText}),
			]);
		} finally {
			await bankTransactionRepository.remove(longSearchTransaction);
		}
	});

	it('applies one or multiple category filters', async () => {
		await bankTransactionRepository.update({id: fixtureTransaction.id}, {category: 'FOOD_AND_DRINK'});
		await bankTransactionRepository.update({id: fixtureGroceriesTransaction.id}, {category: 'SHOPPING'});

		try {
			const singleCategoryResponse = await verifiedAgent
				.get('/bank-transactions')
				.query({'filter[categories][]': 'FOOD_AND_DRINK'})
				.expect(200);

			expect(singleCategoryResponse.body.total).toBe(1);
			expect(singleCategoryResponse.body.transactions[0].description).toBe('Coffee shop');

			const multipleCategoriesResponse = await verifiedAgent
				.get('/bank-transactions')
				.query({'filter[categories][]': ['FOOD_AND_DRINK', 'SHOPPING']})
				.expect(200);

			expect(multipleCategoriesResponse.body.total).toBe(2);
			expect(
				multipleCategoriesResponse.body.transactions.map(({description}: {description: string}) => description),
			).toEqual(['Coffee shop', 'Groceries']);
		} finally {
			await bankTransactionRepository.update({id: fixtureTransaction.id}, {category: null});
			await bankTransactionRepository.update({id: fixtureGroceriesTransaction.id}, {category: null});
		}
	});

	it('filters uncategorized transactions and categorization sources', async () => {
		await bankTransactionRepository.update(
			{id: fixtureTransaction.id},
			{category: 'FOOD_AND_DRINK', categoryStatus: 'COMPLETED', categorySource: 'MANUAL'},
		);
		await bankTransactionRepository.update(
			{id: fixtureGroceriesTransaction.id},
			{category: 'SHOPPING', categoryStatus: 'COMPLETED', categorySource: 'AI'},
		);
		await bankTransactionRepository.update(
			{id: fixtureReviewTransaction.id},
			{
				category: 'NEEDS_REVIEW',
				categoryStatus: 'COMPLETED',
				categorySource: 'AI',
				categoryConfidence: '0.980',
				counterpartyName: null,
				merchantCategoryCode: null,
			},
		);

		try {
			const uncategorizedResponse = await verifiedAgent
				.get('/bank-transactions')
				.query({'filter[categories][]': 'UNCATEGORIZED'})
				.expect(200);

			expect(uncategorizedResponse.body.total).toBe(1);
			expect(
				uncategorizedResponse.body.transactions.every(
					({category}: {category: string | null}) => category === null,
				),
			).toBe(true);

			const needsReviewResponse = await verifiedAgent
				.get('/bank-transactions')
				.query({'filter[categories][]': 'NEEDS_REVIEW'})
				.expect(200);

			expect(needsReviewResponse.body.total).toBe(1);
			expect(needsReviewResponse.body.transactions[0]).toMatchObject({
				description: 'Salary',
				category: 'NEEDS_REVIEW',
				categoryStatus: 'COMPLETED',
				categorySource: 'AI',
				categoryConfidence: '0.980',
			});

			const mixedCategoryResponse = await verifiedAgent
				.get('/bank-transactions')
				.query({'filter[categories][]': ['FOOD_AND_DRINK', 'UNCATEGORIZED']})
				.expect(200);

			expect(mixedCategoryResponse.body.total).toBe(2);
			expect(
				mixedCategoryResponse.body.transactions.map(({description}: {description: string}) => description),
			).toEqual(['Coffee shop', 'Transfer']);

			const manualResponse = await verifiedAgent
				.get('/bank-transactions')
				.query({'filter[categorySources][]': 'MANUAL'})
				.expect(200);

			expect(manualResponse.body.total).toBe(1);
			expect(manualResponse.body.transactions[0].description).toBe('Coffee shop');

			const aiResponse = await verifiedAgent
				.get('/bank-transactions')
				.query({'filter[categorySources][]': 'AI'})
				.expect(200);

			expect(aiResponse.body.total).toBe(2);
			expect(aiResponse.body.transactions.map(({description}: {description: string}) => description)).toEqual([
				'Groceries',
				'Salary',
			]);
		} finally {
			await bankTransactionRepository.update(
				{id: fixtureTransaction.id},
				{category: null, categoryStatus: 'PENDING', categorySource: null},
			);
			await bankTransactionRepository.update(
				{id: fixtureGroceriesTransaction.id},
				{category: null, categoryStatus: 'PENDING', categorySource: null},
			);
			await bankTransactionRepository.update(
				{id: fixtureReviewTransaction.id},
				{
					category: null,
					categoryStatus: 'PENDING',
					categorySource: null,
					categoryConfidence: null,
					categoryPromptVersion: null,
					counterpartyName: 'Employer',
					merchantCategoryCode: null,
				},
			);
		}
	});

	it('exposes and filters currency exchange events without treating them as uncategorized', async () => {
		const currencyExchange = {counterpartyName: null, ...CURRENCY_EXCHANGE_EVENT};
		const [ruleExchange, manualExchange] = await fixtures.createTransactions(fixtureBankAccount, [
			{
				...currencyExchange,
				bookingDate: '2026-08-15',
				valueDate: '2026-08-15',
				amount: '-10.00',
				description: 'Exchanged to GBP',
				categoryStatus: 'NOT_APPLICABLE',
			},
			{
				...currencyExchange,
				bookingDate: '2026-08-14',
				valueDate: '2026-08-14',
				amount: '11.00',
				creditDebitIndicator: 'CRDT',
				description: 'Exchanged to EUR',
				category: 'SHOPPING',
				categoryStatus: 'COMPLETED',
				categorySource: 'MANUAL',
			},
		]);

		try {
			const filteredResponse = await verifiedAgent
				.get('/bank-transactions')
				.query({'filter[financialEventTypes][]': 'CURRENCY_EXCHANGE'})
				.expect(200);

			expect(filteredResponse.body.total).toBe(2);
			expect(filteredResponse.body.transactions).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						id: ruleExchange.id,
						...CURRENCY_EXCHANGE_EVENT,
						cashFlowTreatment: BANK_TRANSACTION_CASH_FLOW_TREATMENTS.INTERNAL,
						category: null,
						categoryStatus: 'NOT_APPLICABLE',
					}),
					expect.objectContaining({
						id: manualExchange.id,
						category: 'SHOPPING',
						categorySource: 'MANUAL',
						cashFlowTreatment: BANK_TRANSACTION_CASH_FLOW_TREATMENTS.INTERNAL,
					}),
				]),
			);

			const uncategorizedResponse = await verifiedAgent
				.get('/bank-transactions')
				.query({'filter[categories][]': 'UNCATEGORIZED'})
				.expect(200);
			expect(uncategorizedResponse.body.transactions.map(({id}: {id: string}) => id)).not.toContain(
				ruleExchange.id,
			);

			const connectionResponse = await verifiedAgent
				.get(`/bank-connections/${fixtureConnection.id}/transactions?limit=100`)
				.expect(200);
			expect(connectionResponse.body.transactions).toEqual(
				expect.arrayContaining([
					expect.objectContaining({id: ruleExchange.id, cashFlowTreatment: 'INTERNAL'}),
					expect.objectContaining({id: manualExchange.id, financialEventType: 'CURRENCY_EXCHANGE'}),
				]),
			);
		} finally {
			await bankTransactionRepository.delete([ruleExchange.id, manualExchange.id]);
		}
	});
	it('exposes, filters and overrides own transfers', async () => {
		const revolutConnection = await fixtures.createConnection(account, {aspspName: 'Revolut', aspspCountry: 'LT'});
		const revolutAccount = await fixtures.createBankAccount(revolutConnection, {
			name: 'Jane Example',
			alias: 'Travel',
		});
		const outgoing = await fixtures.createTransaction(fixtureBankAccount, {
			bookingDate: '2026-08-12',
			valueDate: '2026-08-12',
			amount: '-75.00',
			amountInBaseCurrency: '-75.00',
			description: 'SEPA Overboeking Naam: Jane Example Omschrijving: Travel',
			counterpartyName: 'Jane Example',
		});
		const [incoming, gift] = await fixtures.createTransactions(revolutAccount, [
			{
				bookingDate: '2026-08-13',
				valueDate: '2026-08-13',
				amount: '75.00',
				amountInBaseCurrency: '75.00',
				creditDebitIndicator: 'CRDT',
				description: 'Payment from Jane Example',
			},
			{
				bookingDate: '2026-08-11',
				valueDate: '2026-08-11',
				amount: '33.33',
				amountInBaseCurrency: '33.33',
				creditDebitIndicator: 'CRDT',
				description: 'Payment from A Friend',
			},
		]);
		const manualTransfer = await fixtures.createTransaction(fixtureBankAccount, {
			bookingDate: '2026-08-14',
			valueDate: '2026-08-14',
			amount: '-20.00',
			amountInBaseCurrency: '-20.00',
			description: 'SEPA Overboeking Naam: Jane Example Omschrijving: Savings',
			counterpartyName: 'Jane Example',
			category: 'HOUSING_AND_UTILITIES',
			categorySource: 'MANUAL',
		});
		await app.get(OwnTransferService).recomputeForOwner(account.id);
		const categoryOf = async (id: string) =>
			bankTransactionRepository.findOneOrFail({
				where: {id},
				select: {id: true, category: true, categoryStatus: true, categorySource: true, categoryProvider: true},
			});

		const pairOf = (id: string, counterpartId: string) =>
			expect.objectContaining({
				id,
				cashFlowTreatment: BANK_TRANSACTION_CASH_FLOW_TREATMENTS.INTERNAL,
				ownTransferOverride: null,
				ownTransfer: {evidence: 'NAME', counterpart: expect.objectContaining({id: counterpartId})},
			});

		try {
			// Own transfers take the transfer category for their direction; a manual category is kept.
			await expect(categoryOf(outgoing.id)).resolves.toMatchObject({
				category: 'TRANSFER_OUT',
				categoryStatus: 'COMPLETED',
				categorySource: null,
				categoryProvider: 'own-transfer',
			});
			await expect(categoryOf(incoming.id)).resolves.toMatchObject({category: 'TRANSFER_IN'});
			await expect(categoryOf(manualTransfer.id)).resolves.toMatchObject({
				category: 'HOUSING_AND_UTILITIES',
				categorySource: 'MANUAL',
			});
			await expect(categoryOf(gift.id)).resolves.toMatchObject({category: null, categoryProvider: null});
			await bankTransactionRepository.delete(manualTransfer.id);

			const filtered = await verifiedAgent
				.get('/bank-transactions')
				.query({'filter[financialEventTypes][]': 'OWN_TRANSFER'})
				.expect(200);
			expect(filtered.body.total).toBe(2);
			expect(filtered.body.transactions).toEqual(
				expect.arrayContaining([pairOf(outgoing.id, incoming.id), pairOf(incoming.id, outgoing.id)]),
			);

			const combined = await verifiedAgent
				.get('/bank-transactions')
				.query({
					'filter[financialEventTypes][]': ['OWN_TRANSFER', 'CURRENCY_EXCHANGE'],
					'filter[bankAccountIds][]': revolutAccount.id,
				})
				.expect(200);
			expect(combined.body.transactions.map(({id}: {id: string}) => id)).toEqual([incoming.id]);

			const detail = await verifiedAgent.get(`/bank-transactions/${outgoing.id}`).expect(200);
			expect(detail.body.ownTransfer).toEqual({
				evidence: 'NAME',
				counterpart: {
					id: incoming.id,
					bankName: 'Revolut',
					bankAccountName: 'Jane Example',
					bankAccountAlias: 'Travel',
					amount: '75.00000000',
					currency: 'EUR',
					bookingDate: '2026-08-13',
				},
			});
			const unrelated = await verifiedAgent.get(`/bank-transactions/${gift.id}`).expect(200);
			expect(unrelated.body).toMatchObject({ownTransfer: null, cashFlowTreatment: 'INCOME'});

			const connectionResponse = await verifiedAgent
				.get(`/bank-connections/${revolutConnection.id}/transactions?limit=100`)
				.expect(200);
			expect(connectionResponse.body.transactions).toEqual(
				expect.arrayContaining([expect.objectContaining({id: incoming.id, cashFlowTreatment: 'INTERNAL'})]),
			);

			const overridePath = `/bank-transactions/${outgoing.id}/own-transfer`;
			await otherVerifiedAgent.patch(overridePath).send({override: 'UNMARKED'}).expect(404);
			await verifiedAgent.patch(overridePath).send({override: 'TRANSFER'}).expect(400);
			await verifiedAgent.patch(overridePath).send({}).expect(400);
			await verifiedAgent.patch('/bank-transactions/not-a-uuid/own-transfer').send({override: null}).expect(400);

			const unmarked = await verifiedAgent.patch(overridePath).send({override: 'UNMARKED'}).expect(200);
			expect(unmarked.body).toMatchObject({
				ownTransfer: null,
				ownTransferOverride: 'UNMARKED',
				cashFlowTreatment: 'EXPENSE',
			});
			// No longer an own transfer: the transfer category is dropped so the row is categorized normally again.
			expect(unmarked.body).toMatchObject({category: null, categoryStatus: 'PENDING', categorySource: null});
			// The other leg keeps its own name evidence, now without a counterpart.
			const freed = await verifiedAgent.get(`/bank-transactions/${incoming.id}`).expect(200);
			expect(freed.body.ownTransfer).toEqual({evidence: 'NAME', counterpart: null});

			const automatic = await verifiedAgent.patch(overridePath).send({override: null}).expect(200);
			expect(automatic.body).toEqual(pairOf(outgoing.id, incoming.id));

			const marked = await verifiedAgent
				.patch(`/bank-transactions/${gift.id}/own-transfer`)
				.send({override: 'MARKED'})
				.expect(200);
			expect(marked.body).toMatchObject({
				ownTransfer: {evidence: 'MANUAL', counterpart: null},
				ownTransferOverride: 'MARKED',
				cashFlowTreatment: 'INTERNAL',
				category: 'TRANSFER_IN',
			});
		} finally {
			await bankConnectionRepository.delete(revolutConnection.id);
			await bankTransactionRepository.delete(outgoing.id);
		}
	});

	it('filters by cash flow, base amount and categorization status', async () => {
		const june = (day: number) => `2026-06-${String(day).padStart(2, '0')}`;
		const rows = await fixtures.createTransactions(fixtureBankAccount, [
			bookedRow(june(1), '-10.00', {valueDate: null}),
			bookedRow(june(2), '-20.00', {valueDate: null, category: 'TRANSFER_OUT'}),
			bookedRow(june(3), '5.00', {valueDate: null, category: 'REFUND'}),
			bookedRow(june(4), '1000.00', {valueDate: null, category: 'INCOME'}),
			bookedRow(june(5), '-50.00', {valueDate: null, category: null, ownTransferEvidence: 'IBAN'}),
			bookedRow(june(6), '50.00', {
				valueDate: null,
				creditDebitIndicator: 'CRDT',
				category: null,
				ownTransferEvidence: 'IBAN',
			}),
			bookedRow(june(7), '-30.00', {
				valueDate: null,
				category: null,
				categoryStatus: 'NOT_APPLICABLE',
				categorySource: null,
				...CURRENCY_EXCHANGE_EVENT,
			}),
			bookedRow(june(8), '-1.00', {valueDate: null, creditDebitIndicator: null}),
			bookedRow(june(9), '-7.00', {valueDate: null, amountInBaseCurrency: null}),
			bookedRow(june(10), '-3.00', {
				valueDate: null,
				category: null,
				categoryStatus: 'FAILED',
				categorySource: null,
			}),
			bookedRow(june(11), '-4.00', {
				valueDate: null,
				category: null,
				categoryStatus: 'PENDING',
				categorySource: null,
			}),
		]);
		const [
			expense,
			transferOut,
			refund,
			salary,
			ownOut,
			ownIn,
			currencyExchange,
			unknown,
			unconverted,
			failed,
			pending,
		] = rows.map(({id}) => id);
		const idsFor = async (filter: Record<string, string | string[]>) => {
			const response = await verifiedAgent
				.get('/bank-transactions')
				.query({
					'filter[bookingDate][from]': june(1),
					'filter[bookingDate][to]': june(30),
					'pagination[pageSize]': '100',
					...filter,
				})
				.expect(200);
			return response.body.transactions.map(({id}: {id: string}) => id).sort();
		};
		const sorted = (...ids: string[]) => [...ids].sort();

		try {
			expect(await idsFor({'filter[cashFlows][]': 'SPENDING'})).toEqual(
				sorted(expense, transferOut, refund, unconverted, failed, pending),
			);
			expect(await idsFor({'filter[cashFlows][]': 'INCOME'})).toEqual([salary]);
			expect(await idsFor({'filter[cashFlows][]': 'INTERNAL'})).toEqual(sorted(ownOut, ownIn, currencyExchange));
			expect(await idsFor({'filter[cashFlows][]': 'UNKNOWN'})).toEqual([unknown]);
			// The two kinds of internal movement, selectable on their own and alongside other cash flows.
			expect(await idsFor({'filter[cashFlows][]': 'CURRENCY_EXCHANGE'})).toEqual([currencyExchange]);
			expect(await idsFor({'filter[cashFlows][]': 'OWN_TRANSFER'})).toEqual(sorted(ownOut, ownIn));
			expect(await idsFor({'filter[cashFlows][]': ['INCOME', 'CURRENCY_EXCHANGE']})).toEqual(
				sorted(salary, currencyExchange),
			);
			expect(await idsFor({'filter[cashFlows][]': ['INCOME', 'UNKNOWN']})).toEqual(sorted(salary, unknown));
			expect(await idsFor({'filter[cashFlows][]': 'SPENDING', 'filter[baseAmount]': 'PRESENT'})).toEqual(
				sorted(expense, transferOut, refund, failed, pending),
			);
			expect(await idsFor({'filter[baseAmount]': 'MISSING'})).toEqual([unconverted]);
			expect(await idsFor({'filter[categoryStatuses][]': 'FAILED'})).toEqual([failed]);
			expect(await idsFor({'filter[categoryStatuses][]': 'CATEGORIZING'})).toEqual([pending]);
			expect(await idsFor({'filter[categoryStatuses][]': ['FAILED', 'CATEGORIZING']})).toEqual(
				sorted(failed, pending),
			);
		} finally {
			await bankTransactionRepository.delete(rows.map(({id}) => id));
		}
	});

	it.each([
		['a positive page index', 'pagination[pageIndex]', '1', 200],
		['the dashboard page size', 'pagination[pageSize]', '5', 200],
		['an existing allowed page size', 'pagination[pageSize]', '50', 200],
		['the maximum page size', 'pagination[pageSize]', '100', 200],
		['a suffix in the page index', 'pagination[pageIndex]', '1oops', 400],
		['a negative page index', 'pagination[pageIndex]', '-1', 400],
		['zero page size', 'pagination[pageSize]', '0', 400],
		['a page size not in the allowed options', 'pagination[pageSize]', '11', 400],
	])('validates pagination input for %s', async (_case, field, value, expectedStatus) => {
		await verifiedAgent
			.get('/bank-transactions')
			.query({[field]: value})
			.expect(expectedStatus);
	});

	it.each([
		['an unsupported sort field', {'sort[by]': 'postedDate'}],
		['an unsupported sort order', {'sort[order]': 'DOWN'}],
		['a search longer than 1000 characters', {'filter[search]': 'x'.repeat(1001)}],
		['an invalid booking date', {'filter[bookingDate][from]': '2026-99-99'}],
		['a malformed bank account ID', {'filter[bankAccountIds][]': 'not-a-uuid'}],
		['an unsupported category', {'filter[categories][]': 'NOT_A_CATEGORY'}],
		['an unsupported categorization source', {'filter[categorySources][]': 'RULE'}],
		['an unsupported financial event', {'filter[financialEventTypes][]': 'TRANSFER'}],
		['an unsupported cash flow', {'filter[cashFlows][]': 'EXPENSE'}],
		['an unsupported base amount state', {'filter[baseAmount]': 'ANY'}],
		['an unsupported categorization status', {'filter[categoryStatuses][]': 'PENDING'}],
	])('rejects %s', async (_case, query) => {
		await verifiedAgent.get('/bank-transactions').query(query).expect(400);
	});

	it('does not expose another account’s transactions or details', async () => {
		const listResponse = await otherVerifiedAgent.get('/bank-transactions').expect(200);
		expect(listResponse.body).toEqual({transactions: [], total: 0});

		await otherVerifiedAgent.get(`/bank-transactions/${fixtureTransaction.id}`).expect(404);
	});

	it('validates transaction IDs and returns not found for missing transactions', async () => {
		await verifiedAgent.get('/bank-transactions/not-a-uuid').expect(400);
		await verifiedAgent.get(`/bank-transactions/${randomUUID()}`).expect(404);
	});

	it('returns safe transaction details for the owner', async () => {
		const response = await verifiedAgent.get(`/bank-transactions/${fixtureTransaction.id}`).expect(200);

		expect(response.body).toMatchObject({
			id: fixtureTransaction.id,
			transactionDate: '2026-08-24',
			description: 'Coffee shop',
			displayDescription: 'Coffee shop',
			counterpartyName: 'Cafe',
			direction: 'EXPENSE',
			transactionType: 'CARD_PAYMENT',
			providerTransactionDescription: 'Card payment',
			balanceAfterAmount: '100.50000000',
			balanceAfterCurrency: 'EUR',
			instructedAmount: '4.50000000',
			instructedCurrency: 'USD',
			exchangeRate: '0.923400000000000000',
			exchangeRateUnitCurrency: 'USD',
			exchangeRateType: 'SPOT',
			referenceNumber: 'reference-coffee',
			referenceNumberScheme: 'RF',
			remittanceInformation: 'Morning coffee',
			bankName: 'ABN AMRO',
			bankAccountAlias: 'Daily spending',
		});
		expect(JSON.stringify(response.body)).not.toContain('provider-transaction-coffee');
		expect(JSON.stringify(response.body)).not.toContain('provider-entry-coffee');
		expect(response.body).not.toHaveProperty('bankTransactionCode');
		expect(response.body).not.toHaveProperty('bankTransactionSubCode');
	});

	it('allows verified owners to correct categories without exposing audit fields', async () => {
		const transactionPath = `/bank-transactions/${fixtureTransaction.id}/category`;

		await otherVerifiedAgent.patch(transactionPath).send({category: 'FOOD_AND_DRINK'}).expect(404);
		await verifiedAgent.patch(transactionPath).send({category: 'NOT_A_CATEGORY'}).expect(400);

		const response = await verifiedAgent.patch(transactionPath).send({category: 'FOOD_AND_DRINK'}).expect(200);

		expect(response.body).toMatchObject({
			id: fixtureTransaction.id,
			category: 'FOOD_AND_DRINK',
			categoryStatus: 'COMPLETED',
			categorySource: 'MANUAL',
			categoryConfidence: null,
		});
		for (const field of [
			'categoryInputHash',
			'categoryAppliedInputHash',
			'categoryProvider',
			'categoryModel',
			'categoryPromptVersion',
			'categoryLastError',
		]) {
			expect(response.body).not.toHaveProperty(field);
		}

		const persisted = await bankTransactionRepository.findOneByOrFail({id: fixtureTransaction.id});
		expect(persisted).toMatchObject({
			category: 'FOOD_AND_DRINK',
			categoryStatus: 'COMPLETED',
			categorySource: 'MANUAL',
			categoryConfidence: null,
			categoryAppliedInputHash: expect.any(String),
			categoryProvider: null,
			categoryModel: null,
			categoryPromptVersion: null,
			categoryLastError: null,
		});
	});
});
