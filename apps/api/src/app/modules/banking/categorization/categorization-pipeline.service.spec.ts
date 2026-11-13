import {
	BANK_TRANSACTION_CATEGORIZATION_BATCH_SIZE,
	CATEGORIZE_BANK_TRANSACTIONS_JOB,
} from '@core/queue/queue.constants';

import {createBankTransaction} from '../../../../../test/fixtures/bank-transaction.fixture';
import {
	claimedRows,
	createCategorizationServices,
	createUpdateQueryBuilder,
	searchOutcomes,
	shoppingSearch,
} from '../../../../../test/fixtures/categorization-services.fixture';
import {BANK_TRANSACTION_FINANCIAL_EVENT_TYPES} from '../bank-transaction-financial-event';
import {createBankTransactionCategorizationInputHash} from './bank-transaction-categorization-input';
import {
	BANK_TRANSACTION_CATEGORIZATION_MANUAL_HISTORY_PROVIDER,
	BANK_TRANSACTION_CATEGORIZATION_PROMPT_VERSION,
	BANK_TRANSACTION_CATEGORIZATION_WEB_SEARCH_FAILED_PROMPT_VERSION,
	BANK_TRANSACTION_CATEGORIZATION_WEB_SEARCH_PROMPT_VERSION,
	BANK_TRANSACTION_CATEGORIZATION_WEB_SEARCH_SKIPPED_PROMPT_VERSION,
} from './bank-transaction-categorization.constants';
import {
	BankTransactionCategorizationProviderError,
	BankTransactionCategorizationUnavailableError,
} from './bank-transaction-categorization.provider';
import {BankTransactionCategorizationWebSearchInput} from './bank-transaction-categorization.types';
import {BANK_TRANSACTION_CATEGORY_RULE_PROVIDER} from './bank-transaction-category-rules';
import {categorizationRetryDelay} from './categorization-scheduler.service';

/** Attempts of a categorize job after an ordinary failure; the worker stops retrying after the last one. */
const ORDINARY_ATTEMPTS = 3;

describe('CategorizationPipeline provider behavior versions', () => {
	it('versions sanitized transaction text separately from prior provider inputs', () => {
		expect(BANK_TRANSACTION_CATEGORIZATION_PROMPT_VERSION).toBe('bank-transaction-categorization-v9');
		expect(BANK_TRANSACTION_CATEGORIZATION_WEB_SEARCH_PROMPT_VERSION).toBe(
			'bank-transaction-categorization-web-search-v7',
		);
		expect(BANK_TRANSACTION_CATEGORIZATION_WEB_SEARCH_SKIPPED_PROMPT_VERSION).toBe(
			'bank-transaction-categorization-web-search-skipped-v5',
		);
		expect(BANK_TRANSACTION_CATEGORIZATION_WEB_SEARCH_FAILED_PROMPT_VERSION).toBe(
			'bank-transaction-categorization-web-search-failed-v5',
		);
	});
});

describe('CategorizationPipeline', () => {
	it('does not send a stale financial-event job to the provider', async () => {
		const transaction = createBankTransaction({
			id: 'stale-exchange-transaction',
			categoryStatus: 'PENDING',
			financialEventType: BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
		});
		const {pipeline, provider} = createCategorizationServices({rows: [transaction]});

		await pipeline.processTransactionJob([transaction.id]);

		expect(provider.categorize).not.toHaveBeenCalled();
		expect(provider.categorizeWithWebSearch).not.toHaveBeenCalled();
	});

	it('does not send an own transfer to the provider', async () => {
		const transaction = createBankTransaction({
			id: 'own-transfer-transaction',
			categoryStatus: 'PENDING',
			ownTransferEvidence: 'NAME',
		});
		const {pipeline, provider} = createCategorizationServices({rows: [transaction]});

		await pipeline.processTransactionJob([transaction.id]);

		expect(provider.categorize).not.toHaveBeenCalled();
		expect(provider.categorizeWithWebSearch).not.toHaveBeenCalled();
	});

	it('does not search a row the batch no longer holds after standard categorization', async () => {
		const transaction = createBankTransaction({id: 'web-reclassified-transaction'});
		// The claim takes the row; by the first search it has become a currency exchange, so the renewal skips it.
		const queryBuilder = createUpdateQueryBuilder([claimedRows(transaction.id), claimedRows()]);
		const {pipeline, provider} = createCategorizationServices({
			rows: [transaction],
			webSearchEnabled: true,
			queryBuilder,
			providerResult: [{correlationId: transaction.id, category: 'OTHER', confidence: 0.5}],
		});

		await pipeline.processTransactionJob([transaction.id]);

		expect(provider.categorize).toHaveBeenCalledTimes(1);
		expect(provider.categorizeWithWebSearch).not.toHaveBeenCalled();
	});

	it('sends only normal OTHER results to the web fallback and applies the web result', async () => {
		const specific = createBankTransaction({id: 'specific-transaction', counterpartyName: 'Cafe'});
		const other = createBankTransaction({id: 'other-transaction', counterpartyName: 'Ambiguous Cafe'});
		const {pipeline, provider} = createCategorizationServices({
			rows: [specific, other],
			webSearchEnabled: true,
			providerResult: [
				{correlationId: specific.id, category: 'FOOD_AND_DRINK', confidence: 0.9},
				{correlationId: other.id, category: 'OTHER', confidence: 0.2},
			],
			webSearchResult: [{correlationId: other.id, category: 'SHOPPING', confidence: 0.8}],
		});

		await pipeline.processTransactionJob([specific.id, other.id]);

		expect(provider.categorize).toHaveBeenCalledTimes(1);
		expect(provider.categorize.mock.calls[0][0]).toHaveLength(2);
		expect(provider.categorizeWithWebSearch).toHaveBeenCalledTimes(1);
		expect(provider.categorizeWithWebSearch.mock.calls[0][0]).toEqual([
			expect.objectContaining({
				correlationId: other.id,
				amount: '-12.50',
				currency: 'EUR',
				direction: 'EXPENSE',
				transactionType: 'CARD_PAYMENT',
				merchantName: 'Ambiguous Cafe',
				merchantLocation: null,
				searchQuery: 'Ambiguous Cafe',
				merchantCategoryCode: null,
			}),
		]);
		expect(specific.category).toBe('FOOD_AND_DRINK');
		expect(specific.categoryPromptVersion).toBe(BANK_TRANSACTION_CATEGORIZATION_PROMPT_VERSION);
		expect(other.category).toBe('SHOPPING');
		expect(other.categoryPromptVersion).toBe(BANK_TRANSACTION_CATEGORIZATION_WEB_SEARCH_PROMPT_VERSION);
	});

	it('categorizes the rows it claimed and fails the job when another row cannot be claimed', async () => {
		const failing = createBankTransaction({id: 'failing-transaction', counterpartyName: 'Cafe'});
		const claimable = createBankTransaction({id: 'claimable-transaction', counterpartyName: 'Bakery'});
		const {pipeline, provider, repository} = createCategorizationServices({
			rows: [failing, claimable],
			providerResult: [{correlationId: claimable.id, category: 'FOOD_AND_DRINK', confidence: 0.9}],
		});
		const claimError = new Error('connection lost');
		repository.update.mockImplementation(({id}: {id: string}) =>
			id === failing.id ? Promise.reject(claimError) : Promise.resolve({affected: 1}),
		);

		await expect(pipeline.processTransactionJob([failing.id, claimable.id])).rejects.toBe(claimError);

		expect(provider.categorize).toHaveBeenCalledTimes(1);
		expect(provider.categorize.mock.calls[0][0]).toEqual([expect.objectContaining({correlationId: claimable.id})]);
		expect(claimable.category).toBe('FOOD_AND_DRINK');
		expect(failing.categoryStatus).toBe('PENDING');
	});

	it('passes the transaction ASPSP when normalizing provider-specific codes', async () => {
		const transaction = createBankTransaction({
			id: 'numeric-card-transaction',
			transactionType: 'OTHER',
			bankTransactionCode: '426',
			bankTransactionSubCode: null,
			bankAccount: {bankConnection: {aspspName: 'ABN AMRO'}} as never,
		});
		const {pipeline, provider} = createCategorizationServices({
			rows: [transaction],
			providerResult: [{correlationId: transaction.id, category: 'OTHER', confidence: 0.5}],
		});

		await pipeline.processTransactionJob([transaction.id]);

		expect(provider.categorize.mock.calls[0][0]).toEqual([
			expect.objectContaining({correlationId: transaction.id, transactionType: 'CARD_PAYMENT'}),
		]);
	});

	it.each(['claude-api', 'claude-subscription'])(
		'persists the actual %s result provider and model instead of configured defaults',
		async (provider) => {
			const transaction = createBankTransaction({id: 'routed-transaction'});
			const result = {
				correlationId: transaction.id,
				category: 'FOOD_AND_DRINK' as const,
				confidence: 0.9,
				provider,
				model: 'actual-model',
			};
			const {pipeline} = createCategorizationServices({rows: [transaction], providerResult: [result]});

			await pipeline.processTransactionJob([transaction.id]);

			expect(transaction).toMatchObject({categoryProvider: provider, categoryModel: 'actual-model'});
		},
	);

	it('persists NEEDS_REVIEW as a completed category', async () => {
		const transaction = createBankTransaction({id: 'ambiguous-transaction'});
		const {pipeline} = createCategorizationServices({
			rows: [transaction],
			providerResult: [{correlationId: transaction.id, category: 'NEEDS_REVIEW', confidence: 0.1}],
		});

		await pipeline.processTransactionJob([transaction.id]);

		expect(transaction.category).toBe('NEEDS_REVIEW');
		expect(transaction.categoryStatus).toBe('COMPLETED');
		expect(transaction.categorySource).toBe('AI');
		expect(transaction.categoryConfidence).toBe('0.1');
	});

	it.each(['OTHER', 'NEEDS_REVIEW'] as const)(
		'searches subscription %s results the same way as API results',
		async (category) => {
			const transaction = createBankTransaction({
				id: `subscription-${category}`,
				counterpartyName: 'Example Shop',
			});
			const {pipeline, provider} = createCategorizationServices({
				rows: [transaction],
				webSearchEnabled: true,
				providerResult: [
					{
						correlationId: transaction.id,
						category,
						confidence: 0.3,
						provider: 'claude-subscription',
						model: 'subscription-model',
					},
				],
			});

			await pipeline.processTransactionJob([transaction.id]);

			expect(provider.categorizeWithWebSearch).toHaveBeenCalledTimes(1);
			expect(provider.categorizeWithWebSearch.mock.calls[0][0][0].correlationId).toBe(transaction.id);
		},
	);

	it('keeps routing metadata and search decisions independent within a mixed-route batch', async () => {
		const subscription = createBankTransaction({id: 'subscription-row', counterpartyName: 'Example Shop'});
		const api = createBankTransaction({id: 'api-row', counterpartyName: 'Example Cafe'});
		const {pipeline, provider} = createCategorizationServices({
			rows: [subscription, api],
			webSearchEnabled: true,
			providerResult: [
				{
					correlationId: subscription.id,
					category: 'OTHER',
					confidence: 0.3,
					provider: 'claude-subscription',
					model: 'subscription-model',
				},
				{
					correlationId: api.id,
					category: 'OTHER',
					confidence: 0.3,
					provider: 'claude-api',
					model: 'standard-model',
				},
			],
			webSearchResult: [
				{
					correlationId: api.id,
					category: 'SHOPPING',
					confidence: 0.8,
					provider: 'claude-api',
					model: 'search-model',
				},
			],
		});

		await pipeline.processTransactionJob([subscription.id, api.id]);

		expect(provider.categorizeWithWebSearch).toHaveBeenCalledTimes(2);
		expect(provider.categorizeWithWebSearch.mock.calls.map((call) => call[0][0].correlationId)).toEqual([
			subscription.id,
			api.id,
		]);
		expect(api).toMatchObject({
			category: 'SHOPPING',
			categoryProvider: 'claude-api',
			categoryModel: 'search-model',
		});
	});

	it('searches the merchant of a card line the model could not place', async () => {
		const transaction = createBankTransaction({
			id: 'vending-transaction',
			counterpartyName: null,
			merchantCategoryCode: 'not-an-mcc',
			description: 'BEA, Google Pay Example Vending Cafe,PAS999 NR:TEST12345, 04.09.26/19:00 TESTVILLE',
		});
		const {pipeline, provider} = createCategorizationServices({
			rows: [transaction],
			webSearchEnabled: true,
			providerResult: [{correlationId: transaction.id, category: 'NEEDS_REVIEW', confidence: 0.4}],
			webSearchResult: [
				{
					correlationId: transaction.id,
					category: 'FOOD_AND_DRINK',
					confidence: 0.94,
					searchTrace: {
						queries: ['Example Vending Cafe TESTVILLE'],
						sourceDomains: ['example.test'],
						evidenceType: 'PURCHASE_CONTEXT',
					},
				},
			],
		});

		await pipeline.processTransactionJob([transaction.id]);

		expect(provider.categorizeWithWebSearch).toHaveBeenCalledTimes(1);
		expect(provider.categorizeWithWebSearch.mock.calls[0][0]).toEqual([
			expect.objectContaining({
				merchantName: 'Example Vending Cafe',
				merchantLocation: 'TESTVILLE',
				searchQuery: 'Example Vending Cafe TESTVILLE',
			}),
		]);
		expect(transaction.category).toBe('FOOD_AND_DRINK');
		expect(transaction.categorySearchTrace).toEqual({
			queries: ['Example Vending Cafe TESTVILLE'],
			sourceDomains: ['example.test'],
			evidenceType: 'PURCHASE_CONTEXT',
		});
	});

	it('accepts web Transportation from the identity of a transport merchant', async () => {
		const transaction = createBankTransaction({id: 'web-transportation-transaction'});
		const searchTrace = {
			queries: ['Opaque merchant'],
			sourceDomains: ['example.com'],
			evidenceType: 'MERCHANT_IDENTITY_ONLY' as const,
		};
		const {pipeline} = createCategorizationServices({
			rows: [transaction],
			webSearchEnabled: true,
			providerResult: [{correlationId: transaction.id, category: 'OTHER', confidence: 0.5}],
			webSearchResult: [
				{
					correlationId: transaction.id,
					category: 'TRANSPORTATION',
					confidence: 0.91,
					searchTrace,
				},
			],
		});

		await pipeline.processTransactionJob([transaction.id]);

		expect(transaction.category).toBe('TRANSPORTATION');
		expect(transaction.categoryStatus).toBe('COMPLETED');
		expect(transaction.categoryConfidence).toBe('0.91');
		expect(transaction.categorySearchTrace).toEqual(searchTrace);
		expect(transaction.categoryPromptVersion).toBe(BANK_TRANSACTION_CATEGORIZATION_WEB_SEARCH_PROMPT_VERSION);
	});

	it.each(['INSUFFICIENT', 'CONFLICTING'] as const)(
		'keeps web Transportation with %s evidence in review',
		async (evidenceType) => {
			const transaction = createBankTransaction({id: `transportation-${evidenceType}`});
			const {pipeline} = createCategorizationServices({
				rows: [transaction],
				webSearchEnabled: true,
				providerResult: [{correlationId: transaction.id, category: 'OTHER', confidence: 0.5}],
				webSearchResult: [
					{
						correlationId: transaction.id,
						category: 'TRANSPORTATION',
						confidence: 0.9,
						searchTrace: {queries: ['Example Rides'], sourceDomains: ['example.com'], evidenceType},
					},
				],
			});

			await pipeline.processTransactionJob([transaction.id]);

			expect(transaction.category).toBe('NEEDS_REVIEW');
			expect(transaction.categoryConfidence).toBe('0');
		},
	);

	it('normalizes web results with insufficient or conflicting evidence to NEEDS_REVIEW', async () => {
		const transaction = createBankTransaction({id: 'conflicting-web-result-transaction'});
		const {pipeline} = createCategorizationServices({
			rows: [transaction],
			webSearchEnabled: true,
			providerResult: [{correlationId: transaction.id, category: 'OTHER', confidence: 0.5}],
			webSearchResult: [
				{
					correlationId: transaction.id,
					category: 'FOOD_AND_DRINK',
					confidence: 0.91,
					searchTrace: {
						queries: ['Conflicting merchant'],
						sourceDomains: ['example.com'],
						evidenceType: 'CONFLICTING',
					},
				},
			],
		});

		await pipeline.processTransactionJob([transaction.id]);

		expect(transaction.category).toBe('NEEDS_REVIEW');
		expect(transaction.categoryStatus).toBe('COMPLETED');
		expect(transaction.categoryConfidence).toBe('0');
	});

	it('does not call web search when the fallback is disabled', async () => {
		const transaction = createBankTransaction({id: 'other-transaction'});
		const {pipeline, provider} = createCategorizationServices({
			rows: [transaction],
			providerResult: [{correlationId: transaction.id, category: 'OTHER', confidence: 0.5}],
		});

		await pipeline.processTransactionJob([transaction.id]);

		expect(provider.categorizeWithWebSearch).not.toHaveBeenCalled();
		expect(transaction.category).toBe('OTHER');
		expect(transaction.categoryPromptVersion).toBe(BANK_TRANSACTION_CATEGORIZATION_PROMPT_VERSION);
	});

	it('runs one web search per OTHER result in a batch, renewing the claims before each', async () => {
		const rows = Array.from({length: 6}, (_, index) =>
			createBankTransaction({id: `other-transaction-${index}`, counterpartyName: `Merchant ${index}`}),
		);
		const {pipeline, provider, repository} = createCategorizationServices({
			rows,
			webSearchEnabled: true,
			providerResult: rows.map(({id}) => ({correlationId: id, category: 'OTHER' as const, confidence: 0.5})),
			webSearchResult: rows.map(({id}) => ({correlationId: id, category: 'SHOPPING' as const, confidence: 0.8})),
		});

		const queryBuilder = createUpdateQueryBuilder();
		const renewals: number[] = [];
		queryBuilder.set.mockImplementation((values: object) => {
			// A renewal moves only the claim time forward, on every row the batch still holds.
			if (Object.keys(values).join() === 'categoryUpdatedAt')
				renewals.push(provider.categorizeWithWebSearch.mock.calls.length);
			return queryBuilder;
		});
		repository.createQueryBuilder.mockReturnValue(queryBuilder);

		await pipeline.processTransactionJob(rows.map(({id}) => id));

		expect(renewals).toEqual([0, 1, 2, 3, 4, 5]);
		expect(provider.categorizeWithWebSearch).toHaveBeenCalledTimes(6);
		expect(provider.categorizeWithWebSearch.mock.calls.map(([inputs]) => inputs.length)).toEqual([
			1, 1, 1, 1, 1, 1,
		]);
		expect(rows.every(({category}) => category === 'SHOPPING')).toBe(true);
		expect(
			rows.every(
				({categoryPromptVersion}) =>
					categoryPromptVersion === BANK_TRANSACTION_CATEGORIZATION_WEB_SEARCH_PROMPT_VERSION,
			),
		).toBe(true);
	});

	it('keeps valid search results and sends only the failed search to review', async () => {
		const rows = Array.from({length: 5}, (_, index) =>
			createBankTransaction({id: `other-transaction-${index}`, counterpartyName: `Merchant ${index}`}),
		);
		const failure = new BankTransactionCategorizationProviderError(
			'Claude categorization request failed (503).',
			true,
		);
		const {pipeline, provider} = createCategorizationServices({
			rows,
			webSearchEnabled: true,
			providerResult: rows.map(({id}) => ({correlationId: id, category: 'OTHER' as const, confidence: 0.5})),
		});
		provider.categorizeWithWebSearch
			.mockImplementationOnce(shoppingSearch)
			.mockImplementationOnce(shoppingSearch)
			.mockImplementationOnce(shoppingSearch)
			.mockImplementationOnce(shoppingSearch)
			.mockRejectedValueOnce(failure);
		const logger = (pipeline as unknown as {logger: {warn(message: string): void}}).logger;
		const warn = jest.spyOn(logger, 'warn').mockImplementation();

		try {
			await pipeline.processTransactionJob(rows.map(({id}) => id));

			expect(provider.categorizeWithWebSearch.mock.calls.map(([inputs]) => inputs.length)).toEqual([
				1, 1, 1, 1, 1,
			]);
			expect(rows.slice(0, 4).every(({category}) => category === 'SHOPPING')).toBe(true);
			expect(
				rows
					.slice(0, 4)
					.every(
						({categoryPromptVersion}) =>
							categoryPromptVersion === BANK_TRANSACTION_CATEGORIZATION_WEB_SEARCH_PROMPT_VERSION,
					),
			).toBe(true);
			expect(rows[4]).toMatchObject({
				category: 'NEEDS_REVIEW',
				categoryStatus: 'COMPLETED',
				categoryConfidence: '0',
				categoryPromptVersion: BANK_TRANSACTION_CATEGORIZATION_WEB_SEARCH_FAILED_PROMPT_VERSION,
			});
		} finally {
			warn.mockRestore();
		}
	});

	it('leaves rows pending, without searching further, once the search is unavailable on both routes', async () => {
		const rows = Array.from({length: 5}, (_, index) =>
			createBankTransaction({id: `pending-search-${index}`, counterpartyName: `Merchant ${index}`}),
		);
		const resolved = createBankTransaction({id: 'resolved-row', counterpartyName: 'Known Merchant'});
		const {pipeline, provider} = createCategorizationServices({
			rows: [...rows, resolved],
			webSearchEnabled: true,
			providerResult: [
				...rows.map(({id}) => ({correlationId: id, category: 'OTHER' as const, confidence: 0.5})),
				{correlationId: resolved.id, category: 'FOOD_AND_DRINK' as const, confidence: 0.9},
			],
		});
		provider.categorizeWithWebSearch
			.mockImplementationOnce(shoppingSearch)
			.mockImplementationOnce(shoppingSearch)
			.mockRejectedValueOnce(new BankTransactionCategorizationUnavailableError());
		const logger = (pipeline as unknown as {logger: {warn(message: string): void}}).logger;
		const warn = jest.spyOn(logger, 'warn').mockImplementation();

		try {
			// Thrown so the queue retries soon; the hourly reconciliation is the backstop.
			await expect(pipeline.processTransactionJob([...rows, resolved].map(({id}) => id))).rejects.toThrow(
				BankTransactionCategorizationUnavailableError,
			);

			expect(provider.categorizeWithWebSearch.mock.calls.map(([inputs]) => inputs.length)).toEqual([1, 1, 1]);
			expect(rows.slice(0, 2).map(({category}) => category)).toEqual(['SHOPPING', 'SHOPPING']);
			for (const row of rows.slice(2))
				expect(row).toMatchObject({
					category: null,
					categoryStatus: 'PENDING',
					categoryLastError: 'Claude categorization is temporarily unavailable.',
				});
			expect(resolved).toMatchObject({category: 'FOOD_AND_DRINK', categoryStatus: 'COMPLETED'});
		} finally {
			warn.mockRestore();
		}
	});

	it('skips OTHER rows without a usable merchant name', async () => {
		const transaction = createBankTransaction({
			id: 'merchantless-transaction',
			counterpartyName: null,
			description: null,
			bankTransactionDescription: null,
		});
		const {pipeline, provider} = createCategorizationServices({rows: [transaction], webSearchEnabled: true});

		await pipeline.processTransactionJob([transaction.id]);

		expect(provider.categorizeWithWebSearch).not.toHaveBeenCalled();
		expect(transaction.category).toBe('OTHER');
		expect(transaction.categoryPromptVersion).toBe(
			BANK_TRANSACTION_CATEGORIZATION_WEB_SEARCH_SKIPPED_PROMPT_VERSION,
		);
	});

	it.each([
		[
			'the provider reports a failed search',
			async (inputs: readonly BankTransactionCategorizationWebSearchInput[]) =>
				searchOutcomes(inputs, () => null),
		],
		[
			'the search call throws',
			async () => {
				throw new BankTransactionCategorizationProviderError(
					'Claude categorization request failed (503).',
					true,
				);
			},
		],
		[
			'the outcome names another row',
			async () => [{correlationId: 'another-row', provider: 'claude-api', result: null}],
		],
	])('sends an OTHER row to review, without retrying, when %s', async (_case, search) => {
		const transaction = createBankTransaction({
			id: 'web-failure-transaction',
			counterpartyName: null,
			merchantCategoryCode: null,
		});
		const {pipeline, provider} = createCategorizationServices({
			rows: [transaction],
			webSearchEnabled: true,
			providerResult: [{correlationId: transaction.id, category: 'OTHER', confidence: 0.56}],
		});
		provider.categorizeWithWebSearch.mockImplementationOnce(search);
		const logger = (pipeline as unknown as {logger: {warn(message: string): void}}).logger;
		const warn = jest.spyOn(logger, 'warn').mockImplementation();

		try {
			await expect(pipeline.processTransactionJob([transaction.id])).resolves.toBeUndefined();
			expect(provider.categorizeWithWebSearch).toHaveBeenCalledTimes(1);
			expect(transaction).toMatchObject({
				category: 'NEEDS_REVIEW',
				categoryStatus: 'COMPLETED',
				categoryConfidence: '0',
				categoryPromptVersion: BANK_TRANSACTION_CATEGORIZATION_WEB_SEARCH_FAILED_PROMPT_VERSION,
				categorySearchTrace: {queries: [], sourceDomains: [], evidenceType: 'INSUFFICIENT'},
			});
			expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^Transaction web-search fallback failed/));
		} finally {
			warn.mockRestore();
		}
	});

	it('records the route that failed a search', async () => {
		const transaction = createBankTransaction({id: 'web-route-failure', counterpartyName: 'Example Shop'});
		const {pipeline, provider} = createCategorizationServices({
			rows: [transaction],
			webSearchEnabled: true,
			providerResult: [{correlationId: transaction.id, category: 'OTHER', confidence: 0.56}],
		});
		provider.categorizeWithWebSearch.mockResolvedValueOnce([
			{correlationId: transaction.id, provider: 'claude-subscription', result: null},
		]);
		const logger = (pipeline as unknown as {logger: {warn(message: string): void}}).logger;
		const warn = jest.spyOn(logger, 'warn').mockImplementation();

		try {
			await pipeline.processTransactionJob([transaction.id]);
			expect(transaction).toMatchObject({category: 'NEEDS_REVIEW', categoryProvider: 'claude-subscription'});
		} finally {
			warn.mockRestore();
		}
	});

	it('categorizes the first 50 records in one provider call and queues the rest as a new batch', async () => {
		const rows = Array.from({length: 51}, (_, index) =>
			createBankTransaction({id: `transaction-${index}`, providerTransactionId: `provider-${index}`}),
		);
		const {pipeline, provider, queue} = createCategorizationServices({rows, webSearchEnabled: true});

		await pipeline.processTransactionJob(rows.map(({id}) => id));

		expect(provider.categorize).toHaveBeenCalledTimes(1);
		expect(provider.categorize.mock.calls[0][0]).toHaveLength(BANK_TRANSACTION_CATEGORIZATION_BATCH_SIZE);
		expect(provider.categorizeWithWebSearch).toHaveBeenCalledTimes(BANK_TRANSACTION_CATEGORIZATION_BATCH_SIZE);
		expect(queue.addBulk).toHaveBeenCalledTimes(1);
		expect(queue.addBulk.mock.calls[0][0]).toHaveLength(1);
		expect(queue.addBulk.mock.calls[0][0][0]).toMatchObject({
			name: CATEGORIZE_BANK_TRANSACTIONS_JOB,
			data: {transactionIds: [rows[50].id]},
		});
	});

	it("never applies the owner's manual category for the same merchant without the model", async () => {
		// One payee can receive different kinds of payments (rent and small shared costs), so even a consistent
		// manual choice is only a hint, with the amounts and dates of the choices so the model can tell them apart.
		const transaction = createBankTransaction({
			id: 'repeat-payee',
			amount: '-5.00',
			bankAccount: {bankConnection: {accountId: 'account-1'}} as never,
			merchantKey: 'EXPENSE:example landlord',
		});
		const queryBuilder = createUpdateQueryBuilder();
		queryBuilder.getRawMany
			.mockResolvedValueOnce([
				{merchantKey: 'EXPENSE:example landlord', category: 'HOUSING_AND_UTILITIES', count: 8},
			] as never)
			.mockResolvedValueOnce([
				{
					merchantKey: 'EXPENSE:example landlord',
					category: 'HOUSING_AND_UTILITIES',
					amount: '-650.00000000',
					currency: 'EUR',
					date: '2026-08-29',
				},
				{
					merchantKey: 'EXPENSE:example landlord',
					category: 'HOUSING_AND_UTILITIES',
					amount: '-125.50000000',
					currency: 'RON',
					date: '2026-04-07',
				},
			] as never);
		const {pipeline, provider} = createCategorizationServices({
			rows: [transaction],
			queryBuilder,
			providerResult: [{correlationId: 'repeat-payee', category: 'TRANSFER_OUT', confidence: 0.9}],
		});

		await pipeline.processTransactionJob([transaction.id]);

		expect(provider.categorize).toHaveBeenCalledTimes(1);
		expect(provider.categorize.mock.calls[0][0][0].previousManualCategories).toEqual([
			{
				category: 'HOUSING_AND_UTILITIES',
				count: 8,
				recentExamples: [
					{amount: '-650.00', currency: 'EUR', date: '2026-08-29'},
					{amount: '-125.50', currency: 'RON', date: '2026-04-07'},
				],
			},
		]);
		expect(transaction).toMatchObject({category: 'TRANSFER_OUT', categorySource: 'AI'});
		expect(transaction.categoryProvider).not.toBe(BANK_TRANSACTION_CATEGORIZATION_MANUAL_HISTORY_PROVIDER);
	});

	it('passes mixed manual categories for the same merchant to the provider', async () => {
		const transaction = createBankTransaction({
			id: 'mixed-merchant',
			bankAccount: {bankConnection: {accountId: 'account-1'}} as never,
			merchantKey: 'EXPENSE:example rides',
		});
		const queryBuilder = createUpdateQueryBuilder();
		queryBuilder.getRawMany.mockResolvedValueOnce([
			{merchantKey: 'EXPENSE:example rides', category: 'FOOD_AND_DRINK', count: 2},
			{merchantKey: 'EXPENSE:example rides', category: 'TRANSPORTATION', count: 1},
		] as never);
		const {pipeline, provider} = createCategorizationServices({rows: [transaction], queryBuilder});

		await pipeline.processTransactionJob([transaction.id]);

		expect(provider.categorize).toHaveBeenCalledTimes(1);
		expect(provider.categorize.mock.calls[0][0][0].previousManualCategories).toEqual([
			{category: 'FOOD_AND_DRINK', count: 2, recentExamples: []},
			{category: 'TRANSPORTATION', count: 1, recentExamples: []},
		]);
		const categoryFilters = [...queryBuilder.where.mock.calls, ...queryBuilder.andWhere.mock.calls].filter(
			([clause]) => String(clause).includes('reusableCategories'),
		);
		expect(categoryFilters.length).toBeGreaterThan(0);
		for (const [, categoryFilter] of categoryFilters) {
			expect(categoryFilter.reusableCategories).not.toContain('NEEDS_REVIEW');
			expect(categoryFilter.reusableCategories).toContain('TRANSPORTATION');
		}
		expect(transaction.categoryPromptVersion).toBe(BANK_TRANSACTION_CATEGORIZATION_PROMPT_VERSION);
	});

	it('categorizes an OVpay card tap by rule without calling the provider', async () => {
		const transaction = createBankTransaction({
			id: 'ovpay-tap',
			description: 'BEA, Betaalpas NLOVEXAMPLE0TAP0001,PAS123 NR:EX0001, 01.01.26/08:00 www.ovpay.nl',
			creditDebitIndicator: 'DBIT',
		});
		const {pipeline, provider} = createCategorizationServices({rows: [transaction]});

		await pipeline.processTransactionJob([transaction.id]);

		expect(provider.categorize).not.toHaveBeenCalled();
		expect(transaction).toMatchObject({
			category: 'TRANSPORTATION',
			categoryStatus: 'COMPLETED',
			categorySource: null,
			categoryProvider: BANK_TRANSACTION_CATEGORY_RULE_PROVIDER,
		});
	});

	it("sends a rule match to the model with the owner's manual choices instead of applying the rule", async () => {
		const transaction = createBankTransaction({
			id: 'ovpay-tap-with-history',
			description: 'BEA, Betaalpas NLOVEXAMPLE0TAP0002,PAS123 NR:EX0001, 01.01.26/08:00 www.ovpay.nl',
			creditDebitIndicator: 'DBIT',
			bankAccount: {bankConnection: {accountId: 'account-1'}} as never,
			merchantKey: 'EXPENSE:nlovexample0tap0002',
		});
		const queryBuilder = createUpdateQueryBuilder();
		queryBuilder.getRawMany.mockResolvedValueOnce([
			{merchantKey: 'EXPENSE:nlovexample0tap0002', category: 'TRAVEL', count: 1},
		] as never);
		const {pipeline, provider} = createCategorizationServices({
			rows: [transaction],
			queryBuilder,
			providerResult: [{correlationId: 'ovpay-tap-with-history', category: 'TRAVEL', confidence: 0.9}],
		});

		await pipeline.processTransactionJob([transaction.id]);

		expect(provider.categorize).toHaveBeenCalledTimes(1);
		expect(transaction).toMatchObject({category: 'TRAVEL', categorySource: 'AI'});
	});

	it('does not categorize when a concurrent input hash update wins the race', async () => {
		const transaction = createBankTransaction();
		const {pipeline, provider, repository} = createCategorizationServices({rows: [transaction]});
		repository.update.mockResolvedValueOnce({affected: 0});

		await pipeline.processTransactionJob([transaction.id]);

		expect(provider.categorize).not.toHaveBeenCalled();
	});

	it('does not refresh the hash when a concurrent event reclassification wins the race', async () => {
		const transaction = createBankTransaction();
		const {pipeline, provider, repository} = createCategorizationServices({rows: [transaction]});
		repository.update.mockImplementationOnce(async (criteria) => {
			expect(criteria).toEqual(expect.objectContaining({financialEventType: expect.anything()}));
			return {affected: 0};
		});

		await pipeline.processTransactionJob([transaction.id]);

		expect(provider.categorize).not.toHaveBeenCalled();
	});

	it('does not reset a row after another worker claims it', async () => {
		const transaction = createBankTransaction({
			categoryStatus: 'PENDING',
			categorySource: 'LEGACY',
			categoryInputHash: 'old-input-hash',
			categoryAppliedInputHash: 'old-input-hash',
		});
		const queryBuilder = createUpdateQueryBuilder([{affected: 0}, claimedRows()]);
		const {pipeline, provider} = createCategorizationServices({rows: [transaction], queryBuilder});

		await pipeline.processTransactionJob([transaction.id]);

		expect(provider.categorize).not.toHaveBeenCalled();
		expect(queryBuilder.andWhere).toHaveBeenCalledWith('"categoryStatus" = :expectedStatus', {
			expectedStatus: 'PENDING',
		});
	});

	it('does not apply a provider result after the claimed input hash changes', async () => {
		const transaction = createBankTransaction();
		const queryBuilder = createUpdateQueryBuilder([claimedRows(transaction.id), {affected: 0}]);
		const {pipeline, provider, repository} = createCategorizationServices({rows: [transaction], queryBuilder});

		await pipeline.processTransactionJob([transaction.id]);

		expect(provider.categorize).toHaveBeenCalledTimes(1);
		expect(queryBuilder.set).toHaveBeenCalledWith(expect.objectContaining({categoryStatus: 'PROCESSING'}));
		expect(transaction.categorySource).toBeNull();
		expect(transaction.category).toBeNull();
		expect(repository.update.mock.calls.some(([, values]) => values.categorySource === 'AI')).toBe(false);
	});

	it('leaves unavailable routes pending and rethrows so the job is retried', async () => {
		const transaction = createBankTransaction();
		const failure = new BankTransactionCategorizationUnavailableError();
		const {pipeline, repository} = createCategorizationServices({rows: [transaction], providerError: failure});

		await expect(pipeline.processTransactionJob([transaction.id])).rejects.toBe(failure);

		expect(failure).toBeInstanceOf(BankTransactionCategorizationProviderError);
		expect(failure.retryable).toBe(true);
		expect(transaction).toMatchObject({
			category: null,
			categoryStatus: 'PENDING',
			categoryLastError: failure.message,
		});
		const update = repository.createQueryBuilder.mock.results.at(-1)?.value;
		expect(update.set).toHaveBeenLastCalledWith(expect.objectContaining({categoryStatus: 'PENDING'}));
		expect(update.andWhere).toHaveBeenCalledWith('"categoryStatus" = :expectedStatus', {
			expectedStatus: 'PROCESSING',
		});
		expect(update.andWhere).toHaveBeenCalledWith('"categoryInputHash" = :inputHash', {
			inputHash: transaction.categoryInputHash,
		});
		expect(update.andWhere).toHaveBeenCalledWith('"categorySource" IS DISTINCT FROM \'MANUAL\'');
	});

	it('keeps a same-input category and its metadata pending when routes are unavailable', async () => {
		const transaction = createBankTransaction({
			category: 'SHOPPING',
			categoryStatus: 'PENDING',
			categorySource: 'AI',
			categoryConfidence: '0.9',
			categoryProvider: 'claude-api',
			categoryModel: 'previous-model',
		});
		transaction.categoryInputHash = createBankTransactionCategorizationInputHash(transaction);
		transaction.categoryAppliedInputHash = transaction.categoryInputHash;
		const failure = new BankTransactionCategorizationUnavailableError();
		const {pipeline} = createCategorizationServices({rows: [transaction], providerError: failure});

		await expect(pipeline.processTransactionJob([transaction.id])).rejects.toBe(failure);

		expect(transaction).toMatchObject({
			category: 'SHOPPING',
			categoryStatus: 'PENDING',
			categorySource: 'AI',
			categoryConfidence: '0.9',
			categoryProvider: 'claude-api',
			categoryModel: 'previous-model',
			categoryAppliedInputHash: transaction.categoryInputHash,
		});
	});

	it('clears an older-input category while retaining the pending retry when routes are unavailable', async () => {
		const transaction = createBankTransaction({
			category: 'SHOPPING',
			categoryStatus: 'PENDING',
			categorySource: 'AI',
			categoryAppliedInputHash: 'older-input',
		});
		const failure = new BankTransactionCategorizationUnavailableError();
		const {pipeline} = createCategorizationServices({rows: [transaction], providerError: failure});

		await expect(pipeline.processTransactionJob([transaction.id])).rejects.toBe(failure);

		expect(transaction).toMatchObject({
			category: null,
			categoryStatus: 'PENDING',
			categoryAppliedInputHash: null,
			categoryProvider: null,
		});
	});

	it('does not overwrite a concurrent classification when routes become unavailable', async () => {
		const transaction = createBankTransaction();
		const queryBuilder = createUpdateQueryBuilder([claimedRows(transaction.id), {affected: 0}]);
		const failure = new BankTransactionCategorizationUnavailableError();
		const {pipeline, provider} = createCategorizationServices({rows: [transaction], queryBuilder});
		provider.categorize.mockImplementationOnce(async () => {
			Object.assign(transaction, {category: 'SHOPPING', categorySource: 'MANUAL', categoryStatus: 'COMPLETED'});
			throw failure;
		});

		await expect(pipeline.processTransactionJob([transaction.id])).rejects.toBe(failure);

		expect(transaction).toMatchObject({
			category: 'SHOPPING',
			categorySource: 'MANUAL',
			categoryStatus: 'COMPLETED',
		});
	});

	it('keeps nonretryable provider failures failed without throwing', async () => {
		const transaction = createBankTransaction();
		const failure = new BankTransactionCategorizationProviderError('synthetic invalid result', false);
		const {pipeline} = createCategorizationServices({rows: [transaction], providerError: failure});

		await expect(pipeline.processTransactionJob([transaction.id])).resolves.toBeUndefined();

		expect(transaction).toMatchObject({
			category: null,
			categoryStatus: 'FAILED',
			categoryLastError: 'Transaction categorization failed.',
		});
	});

	it.each([
		[
			'a retryable provider failure',
			async () => {
				throw new BankTransactionCategorizationProviderError(
					'Claude categorization request failed (503).',
					true,
				);
			},
			'Claude categorization request failed (503).',
		],
	])('marks the batch failed and rethrows for a bounded retry after %s', async (_case, categorize, lastError) => {
		const transaction = createBankTransaction();
		const {pipeline, provider, repository} = createCategorizationServices({rows: [transaction]});
		provider.categorize.mockImplementationOnce(categorize);

		const error = await pipeline.processTransactionJob([transaction.id]).then(
			() => undefined,
			(reason: unknown) => reason,
		);
		expect(error).toBeInstanceOf(BankTransactionCategorizationProviderError);
		expect(error).not.toBeInstanceOf(BankTransactionCategorizationUnavailableError);
		expect(error).toMatchObject({retryable: true});
		expect(categorizationRetryDelay(ORDINARY_ATTEMPTS, error)).toBe(-1);
		const failedUpdate = repository.createQueryBuilder.mock.results.at(-1)?.value;
		expect(failedUpdate.set).toHaveBeenCalledWith(
			expect.objectContaining({categoryStatus: 'FAILED', categoryLastError: lastError}),
		);
	});

	it('keeps a category given for the same input when the model call fails', async () => {
		const transaction = createBankTransaction({
			category: 'SHOPPING',
			categoryStatus: 'PENDING',
			categorySource: 'HISTORY',
		});
		transaction.categoryInputHash = createBankTransactionCategorizationInputHash(transaction);
		transaction.categoryAppliedInputHash = transaction.categoryInputHash;
		const failure = new BankTransactionCategorizationProviderError(
			'Claude categorization request failed (503).',
			true,
		);
		const {pipeline, repository} = createCategorizationServices({rows: [transaction], providerError: failure});

		await expect(pipeline.processTransactionJob([transaction.id])).rejects.toBe(failure);

		const failedUpdate = repository.createQueryBuilder.mock.results.at(-1)?.value;
		const [values] = failedUpdate.set.mock.calls.at(-1);
		expect(values).toMatchObject({categoryStatus: 'FAILED', categoryLastError: failure.message});
		expect(values).not.toHaveProperty('category');
		expect(transaction).toMatchObject({category: 'SHOPPING', categoryStatus: 'FAILED'});
	});

	it('clears a category given for an older input when the model call fails', async () => {
		const transaction = createBankTransaction({
			category: 'SHOPPING',
			categoryStatus: 'PENDING',
			categorySource: 'AI',
		});
		transaction.categoryInputHash = createBankTransactionCategorizationInputHash(transaction);
		transaction.categoryAppliedInputHash = 'older-input';
		const failure = new BankTransactionCategorizationProviderError(
			'Claude categorization request failed (503).',
			true,
		);
		const {pipeline} = createCategorizationServices({rows: [transaction], providerError: failure});

		await expect(pipeline.processTransactionJob([transaction.id])).rejects.toBe(failure);

		expect(transaction).toMatchObject({category: null, categoryStatus: 'FAILED'});
	});

	it("skips the web search when the model finds a row unlike the owner's own choices", async () => {
		const transaction = createBankTransaction({
			id: 'small-transfer',
			amount: '-5.00',
			bankAccount: {bankConnection: {accountId: 'account-1'}} as never,
			merchantKey: 'EXPENSE:example landlord',
		});
		const queryBuilder = createUpdateQueryBuilder();
		queryBuilder.getRawMany.mockResolvedValueOnce([
			{merchantKey: 'EXPENSE:example landlord', category: 'HOUSING_AND_UTILITIES', count: 3},
		] as never);
		const {pipeline, provider} = createCategorizationServices({
			rows: [transaction],
			queryBuilder,
			webSearchEnabled: true,
			providerResult: [{correlationId: 'small-transfer', category: 'NEEDS_REVIEW', confidence: 0.4}],
		});

		await pipeline.processTransactionJob([transaction.id]);

		expect(provider.categorizeWithWebSearch).not.toHaveBeenCalled();
		expect(transaction).toMatchObject({category: 'NEEDS_REVIEW', categorySource: 'AI'});
	});

	it('sends at most the five newest manual choices per category as examples, with trimmed amounts', async () => {
		const transaction = createBankTransaction({
			id: 'many-choices',
			bankAccount: {bankConnection: {accountId: 'account-1'}} as never,
			merchantKey: 'EXPENSE:example shop',
		});
		const amounts = ['-1.00000000', '-12.34500000', '-1.23456789', '0.00000000', '100', '-6.10000000', '-7.00'];
		const queryBuilder = createUpdateQueryBuilder();
		queryBuilder.getRawMany
			.mockResolvedValueOnce([{merchantKey: 'EXPENSE:example shop', category: 'SHOPPING', count: 7}] as never)
			.mockResolvedValueOnce(
				amounts.map((amount, index) => ({
					merchantKey: 'EXPENSE:example shop',
					category: 'SHOPPING',
					amount,
					currency: 'EUR',
					date: `2026-09-0${7 - index}`,
				})) as never,
			);
		const {pipeline, provider} = createCategorizationServices({rows: [transaction], queryBuilder});

		await pipeline.processTransactionJob([transaction.id]);

		expect(provider.categorize.mock.calls[0][0][0].previousManualCategories).toEqual([
			{
				category: 'SHOPPING',
				count: 7,
				recentExamples: [
					{amount: '-1.00', currency: 'EUR', date: '2026-09-07'},
					{amount: '-12.345', currency: 'EUR', date: '2026-09-06'},
					{amount: '-1.23456789', currency: 'EUR', date: '2026-09-05'},
					{amount: '0.00', currency: 'EUR', date: '2026-09-04'},
					{amount: '100', currency: 'EUR', date: '2026-09-03'},
				],
			},
		]);
	});
});
