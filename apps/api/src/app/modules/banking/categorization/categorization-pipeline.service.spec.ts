import {
	BANK_TRANSACTION_CATEGORIZATION_BATCH_SIZE,
	CATEGORIZE_BANK_TRANSACTIONS_JOB,
} from '@core/queue/queue.constants';

import {createBankTransaction} from '../../../../../test/fixtures/bank-transaction.fixture';
import {
	claimedRows,
	createCategorizationServices,
	createUpdateQueryBuilder,
	withRoute,
} from '../../../../../test/fixtures/categorization-services.fixture';
import {BANK_TRANSACTION_FINANCIAL_EVENT_TYPES} from '../bank-transaction-financial-event';
import {createBankTransactionCategorizationInputHash} from './bank-transaction-categorization-input';
import {
	BANK_TRANSACTION_CATEGORIZATION_MANUAL_HISTORY_PROVIDER,
	BANK_TRANSACTION_CATEGORIZATION_PROMPT_VERSION,
} from './bank-transaction-categorization.constants';
import {
	BankTransactionCategorizationProviderError,
	BankTransactionCategorizationUnavailableError,
} from './bank-transaction-categorization.provider';
import {BankTransactionCategorizationInput} from './bank-transaction-categorization.types';
import {categorizationRetryDelay} from './categorization-scheduler.service';

/** Attempts of a categorize job after an ordinary failure; the worker stops retrying after the last one. */
const ORDINARY_ATTEMPTS = 3;

describe('CategorizationPipeline provider behavior versions', () => {
	it('versions the categorization prompt separately from prior provider inputs', () => {
		expect(BANK_TRANSACTION_CATEGORIZATION_PROMPT_VERSION).toBe('bank-transaction-categorization-v15');
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
	});

	it("sends each merchant's rows in one call that may search for that merchant", async () => {
		const cafeLunch = createBankTransaction({
			id: 'cafe-lunch',
			counterpartyName: 'Example Cafe',
			remittanceInformation: 'Lunch order',
			merchantCategoryCode: '5814',
		});
		const cafeDinner = createBankTransaction({id: 'cafe-dinner', counterpartyName: 'Example Cafe'});
		const shop = createBankTransaction({id: 'shop', counterpartyName: 'Example Shop'});
		const unnamed = createBankTransaction({
			id: 'unnamed',
			counterpartyName: null,
			description: null,
			bankTransactionDescription: null,
		});
		const searchTrace = {
			queries: ['Example Cafe'],
			sourceDomains: ['example.test'],
			evidenceType: 'PURCHASE_CONTEXT' as const,
		};
		const {pipeline, provider} = createCategorizationServices({
			rows: [cafeLunch, shop, cafeDinner, unnamed],
			webSearchEnabled: true,
		});
		provider.categorize.mockImplementation(
			async (inputs: readonly BankTransactionCategorizationInput[], _categories, options) =>
				inputs.map(({correlationId}) =>
					withRoute({
						correlationId,
						category: options?.searchQuery === 'Example Cafe' ? 'FOOD_AND_DRINK' : 'SHOPPING',
						confidence: 0.9,
						...(options?.searchQuery === 'Example Cafe' ? {searchTrace} : {}),
					}),
				),
		);

		await pipeline.processTransactionJob([cafeLunch.id, shop.id, cafeDinner.id, unnamed.id]);

		expect(provider.categorize).toHaveBeenCalledTimes(3);
		const [cafeCall, shopCall, unnamedCall] = provider.categorize.mock.calls;
		expect(cafeCall[0]).toEqual([
			expect.objectContaining({
				correlationId: cafeLunch.id,
				counterpartyName: 'Example Cafe',
				remittanceInformation: 'Lunch order',
				merchantCategoryCode: '5814',
				amount: '-12.50',
			}),
			expect.objectContaining({correlationId: cafeDinner.id}),
		]);
		expect(cafeCall[2]).toEqual({searchQuery: 'Example Cafe'});
		expect(shopCall[0]).toEqual([expect.objectContaining({correlationId: shop.id})]);
		expect(shopCall[2]).toEqual({searchQuery: 'Example Shop'});
		// Without merchant text there is nothing to search for.
		expect(unnamedCall[0]).toEqual([expect.objectContaining({correlationId: unnamed.id})]);
		expect(unnamedCall[2]).toEqual({});
		for (const row of [cafeLunch, cafeDinner])
			expect(row).toMatchObject({
				category: 'FOOD_AND_DRINK',
				categoryStatus: 'COMPLETED',
				categorySearchTrace: searchTrace,
				categoryPromptVersion: BANK_TRANSACTION_CATEGORIZATION_PROMPT_VERSION,
			});
		// A call that skipped its search stores no trace.
		for (const row of [shop, unnamed])
			expect(row).toMatchObject({
				category: 'SHOPPING',
				categorySearchTrace: null,
				categoryPromptVersion: BANK_TRANSACTION_CATEGORIZATION_PROMPT_VERSION,
			});
	});

	it('sends the whole batch in one call without search when web search is off', async () => {
		const rows = [
			createBankTransaction({id: 'cafe', counterpartyName: 'Example Cafe'}),
			createBankTransaction({id: 'shop', counterpartyName: 'Example Shop'}),
		];
		const {pipeline, provider} = createCategorizationServices({rows});

		await pipeline.processTransactionJob(rows.map(({id}) => id));

		expect(provider.categorize).toHaveBeenCalledTimes(1);
		expect(provider.categorize.mock.calls[0][0]).toHaveLength(2);
		expect(provider.categorize.mock.calls[0][2]).toEqual({});
		expect(
			rows.every(
				({categoryPromptVersion}) => categoryPromptVersion === BANK_TRANSACTION_CATEGORIZATION_PROMPT_VERSION,
			),
		).toBe(true);
	});

	it('renews the claims of the rows still waiting before every call after the first', async () => {
		const rows = Array.from({length: 3}, (_, index) =>
			createBankTransaction({id: `merchant-row-${index}`, counterpartyName: `Merchant ${index}`}),
		);
		const {pipeline, provider, repository} = createCategorizationServices({rows, webSearchEnabled: true});
		const queryBuilder = createUpdateQueryBuilder();
		const renewals: {calls: number; ids: string[]}[] = [];
		let renewing = false;
		queryBuilder.set.mockImplementation((values: object) => {
			// A renewal moves only the claim time forward, on the rows it names next.
			renewing = Object.keys(values).join() === 'categoryUpdatedAt';
			return queryBuilder;
		});
		const where = queryBuilder.where.getMockImplementation()!;
		queryBuilder.where.mockImplementation((sql: string, parameters?: {claimedIds?: string[]}) => {
			if (renewing && parameters?.claimedIds)
				renewals.push({calls: provider.categorize.mock.calls.length, ids: parameters.claimedIds});
			return where(sql, parameters);
		});
		repository.createQueryBuilder.mockReturnValue(queryBuilder);

		await pipeline.processTransactionJob(rows.map(({id}) => id));

		expect(provider.categorize).toHaveBeenCalledTimes(3);
		expect(renewals.map(({calls}) => calls)).toEqual([1, 2]);
		expect(renewals.map(({ids}) => ids.length)).toEqual([2, 1]);
	});

	it('does not send a group the batch no longer holds', async () => {
		const first = createBankTransaction({id: 'first-merchant', counterpartyName: 'Example Cafe'});
		const second = createBankTransaction({id: 'second-merchant', counterpartyName: 'Example Shop'});
		// The claim takes both rows; by the second call the other row has become a currency exchange.
		const queryBuilder = createUpdateQueryBuilder([claimedRows(first.id, second.id), {affected: 1}, claimedRows()]);
		const {pipeline, provider} = createCategorizationServices({
			rows: [first, second],
			webSearchEnabled: true,
			queryBuilder,
		});

		await pipeline.processTransactionJob([first.id, second.id]);

		expect(provider.categorize).toHaveBeenCalledTimes(1);
		expect(provider.categorize.mock.calls[0][0]).toEqual([expect.objectContaining({correlationId: first.id})]);
	});

	it('completes the other groups and retries only the rows of a group whose call failed', async () => {
		const failing = createBankTransaction({id: 'failing-merchant', counterpartyName: 'Example Cafe'});
		const working = createBankTransaction({id: 'working-merchant', counterpartyName: 'Example Shop'});
		const failure = new BankTransactionCategorizationProviderError(
			'Claude returned an invalid categorization response.',
			true,
		);
		const {pipeline, provider} = createCategorizationServices({
			rows: [failing, working],
			webSearchEnabled: true,
			providerResult: [{correlationId: working.id, category: 'SHOPPING', confidence: 0.8}],
		});
		provider.categorize.mockRejectedValueOnce(failure);

		await expect(pipeline.processTransactionJob([failing.id, working.id])).rejects.toBe(failure);

		expect(provider.categorize).toHaveBeenCalledTimes(2);
		expect(failing).toMatchObject({categoryStatus: 'FAILED', categoryLastError: failure.message});
		expect(working).toMatchObject({category: 'SHOPPING', categoryStatus: 'COMPLETED'});
	});

	it('fails the job when a result cannot be saved, so the queue retries it', async () => {
		const transaction = createBankTransaction({id: 'unsaved-result', counterpartyName: 'Example Cafe'});
		// The claim takes the row; the write that completes it fails.
		const queryBuilder = createUpdateQueryBuilder();
		const writeError = new Error('synthetic connection lost');
		queryBuilder.execute
			.mockResolvedValueOnce(claimedRows(transaction.id) as never)
			.mockRejectedValueOnce(writeError);
		const {pipeline, provider} = createCategorizationServices({
			rows: [transaction],
			webSearchEnabled: true,
			queryBuilder,
		});

		await expect(pipeline.processTransactionJob([transaction.id])).rejects.toBe(writeError);

		expect(provider.categorize).toHaveBeenCalledTimes(1);
		expect(transaction.categoryStatus).not.toBe('FAILED');
	});

	it('leaves the rest of the batch pending, without further calls, once both routes are unavailable', async () => {
		const resolved = createBankTransaction({id: 'resolved-merchant', counterpartyName: 'Example Shop'});
		const unavailable = createBankTransaction({id: 'unavailable-merchant', counterpartyName: 'Example Cafe'});
		const waiting = createBankTransaction({id: 'waiting-merchant', counterpartyName: 'Example Bakery'});
		const failure = new BankTransactionCategorizationUnavailableError();
		const {pipeline, provider} = createCategorizationServices({
			rows: [resolved, unavailable, waiting],
			webSearchEnabled: true,
			providerResult: [{correlationId: resolved.id, category: 'SHOPPING', confidence: 0.8}],
		});
		provider.categorize.mockImplementationOnce(async () => [
			withRoute({correlationId: resolved.id, category: 'SHOPPING', confidence: 0.8}),
		]);
		provider.categorize.mockRejectedValueOnce(failure);

		// Thrown so the queue retries soon; the hourly reconciliation is the backstop.
		await expect(pipeline.processTransactionJob([resolved.id, unavailable.id, waiting.id])).rejects.toBe(failure);

		expect(provider.categorize).toHaveBeenCalledTimes(2);
		expect(resolved).toMatchObject({category: 'SHOPPING', categoryStatus: 'COMPLETED'});
		for (const row of [unavailable, waiting])
			expect(row).toMatchObject({categoryStatus: 'PENDING', categoryLastError: failure.message});
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

	it('categorizes the first 50 records in one provider call and queues the rest as a new batch', async () => {
		const rows = Array.from({length: 51}, (_, index) =>
			createBankTransaction({id: `transaction-${index}`, providerTransactionId: `provider-${index}`}),
		);
		const {pipeline, provider, queue} = createCategorizationServices({rows});

		await pipeline.processTransactionJob(rows.map(({id}) => id));

		expect(provider.categorize).toHaveBeenCalledTimes(1);
		expect(provider.categorize.mock.calls[0][0]).toHaveLength(BANK_TRANSACTION_CATEGORIZATION_BATCH_SIZE);
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
					remittanceInformation: 'Rent september',
					description: null,
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
					{amount: '-650.00', currency: 'EUR', date: '2026-08-29', text: 'Rent september'},
					{amount: '-125.50', currency: 'RON', date: '2026-04-07', text: null},
				],
			},
		]);
		expect(transaction).toMatchObject({category: 'TRANSFER_OUT', categorySource: 'AI'});
		expect(transaction.categoryProvider).not.toBe(BANK_TRANSACTION_CATEGORIZATION_MANUAL_HISTORY_PROVIDER);
	});

	it('passes every manual category for the same merchant to the provider, one-offs included', async () => {
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

	it('does not categorize a row another worker claimed first', async () => {
		const transaction = createBankTransaction({
			category: 'SHOPPING',
			categoryStatus: 'PENDING',
			categorySource: 'AI',
			categoryInputHash: 'old-input-hash',
			categoryAppliedInputHash: 'old-input-hash',
		});
		const queryBuilder = createUpdateQueryBuilder([claimedRows()]);
		const {pipeline, provider} = createCategorizationServices({rows: [transaction], queryBuilder});

		await pipeline.processTransactionJob([transaction.id]);

		expect(provider.categorize).not.toHaveBeenCalled();
		expect(transaction.category).toBe('SHOPPING');
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

	it('keeps the category of a row sent back for a changed input while routes are unavailable', async () => {
		const transaction = createBankTransaction({
			category: 'SHOPPING',
			categoryStatus: 'PENDING',
			categorySource: 'AI',
			categoryProvider: 'claude-api',
			categoryAppliedInputHash: 'older-input',
		});
		const failure = new BankTransactionCategorizationUnavailableError();
		const {pipeline} = createCategorizationServices({rows: [transaction], providerError: failure});

		await expect(pipeline.processTransactionJob([transaction.id])).rejects.toBe(failure);

		expect(transaction).toMatchObject({
			category: 'SHOPPING',
			categoryStatus: 'PENDING',
			categoryAppliedInputHash: 'older-input',
			categoryProvider: 'claude-api',
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

	it('keeps a category given for an older input when the model call fails', async () => {
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

		expect(transaction).toMatchObject({category: 'SHOPPING', categoryStatus: 'FAILED'});
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
					{amount: '-1.00', currency: 'EUR', date: '2026-09-07', text: null},
					{amount: '-12.345', currency: 'EUR', date: '2026-09-06', text: null},
					{amount: '-1.23456789', currency: 'EUR', date: '2026-09-05', text: null},
					{amount: '0.00', currency: 'EUR', date: '2026-09-04', text: null},
					{amount: '100', currency: 'EUR', date: '2026-09-03', text: null},
				],
			},
		]);
	});
});
