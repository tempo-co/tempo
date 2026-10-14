import {ConfigurationService} from '@core/config/config.service';
import {
	BANK_TRANSACTION_CATEGORIZATION_BATCH_SIZE,
	BANK_TRANSACTION_CATEGORIZATION_QUEUE,
	CATEGORIZE_BANK_TRANSACTIONS_JOB,
} from '@core/queue/queue.constants';

import {createBankTransaction} from '../../../../../test/fixtures/bank-transaction.fixture';
import {BANK_TRANSACTION_FINANCIAL_EVENT_TYPES} from '../bank-transaction-financial-event';
import {BankTransaction} from '../bank-transaction.entity';
import {
	BANK_TRANSACTION_CATEGORIZATION_MANUAL_HISTORY_PROMPT_VERSION,
	BANK_TRANSACTION_CATEGORIZATION_MANUAL_HISTORY_PROVIDER,
	BANK_TRANSACTION_CATEGORIZATION_PROMPT_VERSION,
	BANK_TRANSACTION_CATEGORIZATION_WEB_SEARCH_FAILED_PROMPT_VERSION,
	BANK_TRANSACTION_CATEGORIZATION_WEB_SEARCH_PROMPT_VERSION,
	BANK_TRANSACTION_CATEGORIZATION_WEB_SEARCH_SKIPPED_PROMPT_VERSION,
} from './bank-transaction-categorization.constants';
import {BankTransactionCategorizationProviderError} from './bank-transaction-categorization.provider';
import {BankTransactionCategorizationService} from './bank-transaction-categorization.service';
import {
	BankTransactionCategorizationInput,
	BankTransactionCategorizationResult,
	BankTransactionCategorizationWebSearchInput,
} from './bank-transaction-categorization.types';

function createUpdateQueryBuilder(
	results: readonly {affected: number; raw?: readonly {id: string}[]}[] = [{affected: 1}] as const,
	rawRows: readonly {id: string}[] = [],
) {
	const builder = {
		update: jest.fn().mockReturnThis(),
		select: jest.fn().mockReturnThis(),
		addSelect: jest.fn().mockReturnThis(),
		innerJoin: jest.fn().mockReturnThis(),
		limit: jest.fn().mockReturnThis(),
		set: jest.fn().mockReturnThis(),
		where: jest.fn().mockReturnThis(),
		andWhere: jest.fn().mockReturnThis(),
		orderBy: jest.fn().mockReturnThis(),
		take: jest.fn().mockReturnThis(),
		returning: jest.fn().mockReturnThis(),
		execute: jest.fn().mockResolvedValue({affected: 1}),
		getRawMany: jest.fn().mockResolvedValue(rawRows),
	};
	for (const result of results) builder.execute.mockResolvedValueOnce(result);
	return builder;
}

function createService({
	enabled = true,
	webSearchEnabled = false,
	rows = [],
	providerResult = [],
	providerError,
	webSearchResult,
	webSearchError,
	queryBuilder,
}: {
	enabled?: boolean;
	webSearchEnabled?: boolean;
	rows?: BankTransaction[];
	providerResult?: readonly BankTransactionCategorizationResult[];
	providerError?: BankTransactionCategorizationProviderError;
	webSearchResult?: readonly BankTransactionCategorizationResult[];
	webSearchError?: BankTransactionCategorizationProviderError;
	queryBuilder?: ReturnType<typeof createUpdateQueryBuilder>;
} = {}) {
	const queue = {addBulk: jest.fn().mockResolvedValue([])};
	const provider = {
		categorize: jest.fn().mockImplementation(async (inputs: readonly BankTransactionCategorizationInput[]) => {
			if (providerError) throw providerError;
			return providerResult.length > 0
				? providerResult
				: inputs.map((input) => ({
						correlationId: input.correlationId,
						category: 'OTHER' as const,
						confidence: 0.5,
					}));
		}),
		categorizeWithWebSearch: jest
			.fn()
			.mockImplementation(async (inputs: readonly BankTransactionCategorizationWebSearchInput[]) => {
				if (webSearchError) throw webSearchError;
				return webSearchResult && webSearchResult.length > 0
					? webSearchResult.filter(({correlationId}) =>
							inputs.some((input) => input.correlationId === correlationId),
						)
					: inputs.map((input) => ({
							correlationId: input.correlationId,
							category: 'SHOPPING' as const,
							confidence: 0.75,
						}));
			}),
	};
	const config = {
		get: jest.fn((key: string) => {
			if (key === 'AI_CATEGORIZATION_ENABLED') return enabled;
			if (key === 'AI_CATEGORIZATION_WEB_SEARCH_ENABLED') return webSearchEnabled;
			if (key === 'AI_CATEGORIZATION_PROVIDER') return 'openai';
			if (key === 'AI_CATEGORIZATION_MODEL') return 'configured-model';
			throw new Error(`Unexpected config key: ${key}`);
		}),
	} as unknown as ConfigurationService;
	const repository = {
		find: jest.fn().mockResolvedValue(rows),
		update: jest.fn().mockResolvedValue({affected: 1}),
		createQueryBuilder: jest.fn().mockReturnValue(queryBuilder ?? createUpdateQueryBuilder()),
	};
	const service = new BankTransactionCategorizationService(
		repository as never,
		queue as never,
		provider as never,
		config,
	);
	return {service, queue, provider, repository, config};
}

describe('BankTransactionCategorizationService provider behavior versions', () => {
	it('versions sanitized transaction text separately from prior provider inputs', () => {
		expect(BANK_TRANSACTION_CATEGORIZATION_PROMPT_VERSION).toBe('bank-transaction-categorization-v6');
		expect(BANK_TRANSACTION_CATEGORIZATION_WEB_SEARCH_PROMPT_VERSION).toBe(
			'bank-transaction-categorization-web-search-v6',
		);
		expect(BANK_TRANSACTION_CATEGORIZATION_WEB_SEARCH_SKIPPED_PROMPT_VERSION).toBe(
			'bank-transaction-categorization-web-search-skipped-v5',
		);
		expect(BANK_TRANSACTION_CATEGORIZATION_WEB_SEARCH_FAILED_PROMPT_VERSION).toBe(
			'bank-transaction-categorization-web-search-failed-v5',
		);
	});
});

describe('BankTransactionCategorizationService queue scheduling', () => {
	it('deduplicates transaction IDs and enqueues deterministic batches of 50', async () => {
		const {service, queue} = createService();
		const ids = Array.from(
			{length: BANK_TRANSACTION_CATEGORIZATION_BATCH_SIZE + 1},
			(_, index) => `transaction-${index}`,
		);

		await service.enqueueForTransactions([...ids, ids[0]]);

		expect(queue.addBulk).toHaveBeenCalledTimes(1);
		const jobs = queue.addBulk.mock.calls[0][0];
		expect(jobs).toHaveLength(2);
		expect(jobs[0]).toEqual({
			name: CATEGORIZE_BANK_TRANSACTIONS_JOB,
			data: {transactionIds: expect.any(Array)},
			opts: {jobId: expect.any(String), removeOnFail: true},
		});
		expect(jobs[1]).toEqual({
			name: CATEGORIZE_BANK_TRANSACTIONS_JOB,
			data: {transactionIds: expect.any(Array)},
			opts: {jobId: expect.any(String), removeOnFail: true},
		});
		expect(jobs[0].data.transactionIds).toHaveLength(50);
		expect(jobs[1].data.transactionIds).toHaveLength(1);
		expect([...jobs[0].data.transactionIds, ...jobs[1].data.transactionIds].sort()).toEqual(ids.sort());
	});

	it('changes the job ID when the categorization input hash changes', async () => {
		const transaction = createBankTransaction({categoryInputHash: 'hash-a'});
		const {service, queue} = createService({rows: [transaction]});

		await service.enqueueForTransactions([transaction.id]);
		transaction.categoryInputHash = 'hash-b';
		await service.enqueueForTransactions([transaction.id]);

		expect(queue.addBulk).toHaveBeenCalledTimes(2);
		expect(queue.addBulk.mock.calls[0][0][0].opts.jobId).not.toBe(queue.addBulk.mock.calls[1][0][0].opts.jobId);
	});

	it('does not enqueue when AI categorization is disabled or IDs are empty', async () => {
		const disabled = createService({enabled: false});
		await disabled.service.enqueueForTransactions(['transaction-1']);
		await disabled.service.enqueueForTransactions([]);

		expect(disabled.queue.addBulk).not.toHaveBeenCalled();
		expect(BANK_TRANSACTION_CATEGORIZATION_QUEUE).toBe('bank-transaction-categorization');
	});

	it('does not enqueue financial-event rows for AI categorization', async () => {
		const exchange = createBankTransaction({
			id: 'exchange-transaction',
			financialEventType: BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
		});
		const ordinary = createBankTransaction({id: 'ordinary-transaction'});
		const {service, queue} = createService({rows: [exchange, ordinary]});

		await service.enqueueForTransactions([exchange.id, ordinary.id]);

		expect(queue.addBulk).toHaveBeenCalledTimes(1);
		expect(queue.addBulk.mock.calls[0][0]).toHaveLength(1);
		expect(queue.addBulk.mock.calls[0][0][0].data).toEqual({transactionIds: [ordinary.id]});
	});
});

describe('BankTransactionCategorizationService web-search reconciliation', () => {
	it('does not separately enqueue completed OTHER rows during bootstrap reconciliation', async () => {
		const queryBuilder = createUpdateQueryBuilder();
		queryBuilder.getRawMany.mockResolvedValueOnce([]);
		const {service, queue} = createService({rows: [], webSearchEnabled: true, queryBuilder});

		await service.onApplicationBootstrap();

		expect(queryBuilder.getRawMany).toHaveBeenCalledTimes(1);
		expect(queue.addBulk).not.toHaveBeenCalled();
	});

	it('does not enqueue financial-event rows found by reconciliation', async () => {
		const exchange = createBankTransaction({
			id: 'reconciled-exchange-transaction',
			financialEventType: BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
		});
		const queryBuilder = createUpdateQueryBuilder();
		queryBuilder.getRawMany.mockResolvedValueOnce([{id: exchange.id}]);
		const {service, queue} = createService({rows: [exchange], webSearchEnabled: true, queryBuilder});

		await service.onApplicationBootstrap();

		expect(queryBuilder.getRawMany).toHaveBeenCalledTimes(1);
		expect(queue.addBulk).not.toHaveBeenCalled();
	});
});
describe('BankTransactionCategorizationService worker', () => {
	it('does not send a stale financial-event job to the provider', async () => {
		const transaction = createBankTransaction({
			id: 'stale-exchange-transaction',
			categoryStatus: 'PENDING',
			financialEventType: BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
		});
		const {service, provider} = createService({rows: [transaction]});

		await service.processTransactionJob([transaction.id]);

		expect(provider.categorize).not.toHaveBeenCalled();
		expect(provider.categorizeWithWebSearch).not.toHaveBeenCalled();
	});

	it('does not send a queued row after it becomes a financial event before provider invocation', async () => {
		const transaction = createBankTransaction({id: 'reclassified-exchange-transaction'});
		const reclassifiedTransaction = createBankTransaction({
			id: transaction.id,
			financialEventType: BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
		});
		const {service, provider, repository} = createService({rows: [transaction]});
		repository.find.mockResolvedValueOnce([transaction]).mockResolvedValueOnce([reclassifiedTransaction]);

		await service.processTransactionJob([transaction.id]);

		expect(provider.categorize).not.toHaveBeenCalled();
		expect(provider.categorizeWithWebSearch).not.toHaveBeenCalled();
	});

	it('does not send a queued row that was deleted before provider invocation', async () => {
		const transaction = createBankTransaction({id: 'deleted-transaction'});
		const {service, provider, repository} = createService({rows: [transaction]});
		repository.find.mockResolvedValueOnce([transaction]).mockResolvedValueOnce([]);

		await service.processTransactionJob([transaction.id]);

		expect(provider.categorize).not.toHaveBeenCalled();
		expect(provider.categorizeWithWebSearch).not.toHaveBeenCalled();
	});

	it('does not send a reclassified row to web fallback after standard categorization', async () => {
		const transaction = createBankTransaction({id: 'web-reclassified-transaction'});
		const reclassifiedTransaction = createBankTransaction({
			id: transaction.id,
			financialEventType: BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
		});
		const {service, provider, repository} = createService({
			rows: [transaction],
			webSearchEnabled: true,
			providerResult: [{correlationId: transaction.id, category: 'OTHER', confidence: 0.5}],
		});
		repository.find
			.mockResolvedValueOnce([transaction])
			.mockResolvedValueOnce([transaction])
			.mockResolvedValueOnce([reclassifiedTransaction]);

		await service.processTransactionJob([transaction.id]);

		expect(provider.categorize).toHaveBeenCalledTimes(1);
		expect(provider.categorizeWithWebSearch).not.toHaveBeenCalled();
	});

	it('sends only normal OTHER results to the web fallback and applies the web result', async () => {
		const specific = createBankTransaction({id: 'specific-transaction', counterpartyName: 'Cafe'});
		const other = createBankTransaction({id: 'other-transaction', counterpartyName: 'Ambiguous Cafe'});
		const {service, provider} = createService({
			rows: [specific, other],
			webSearchEnabled: true,
			providerResult: [
				{correlationId: specific.id, category: 'FOOD_AND_DRINK', confidence: 0.9},
				{correlationId: other.id, category: 'OTHER', confidence: 0.2},
			],
			webSearchResult: [{correlationId: other.id, category: 'SHOPPING', confidence: 0.8}],
		});

		await service.processTransactionJob([specific.id, other.id]);

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

	it('passes the transaction ASPSP when normalizing provider-specific codes', async () => {
		const transaction = createBankTransaction({
			id: 'numeric-card-transaction',
			transactionType: 'OTHER',
			bankTransactionCode: '426',
			bankTransactionSubCode: null,
			bankAccount: {bankConnection: {aspspName: 'ABN AMRO'}} as never,
		});
		const {service, provider} = createService({
			rows: [transaction],
			providerResult: [{correlationId: transaction.id, category: 'OTHER', confidence: 0.5}],
		});

		await service.processTransactionJob([transaction.id]);

		expect(provider.categorize.mock.calls[0][0]).toEqual([
			expect.objectContaining({correlationId: transaction.id, transactionType: 'CARD_PAYMENT'}),
		]);
	});

	it('persists NEEDS_REVIEW as a completed category', async () => {
		const transaction = createBankTransaction({id: 'ambiguous-transaction'});
		const {service} = createService({
			rows: [transaction],
			providerResult: [{correlationId: transaction.id, category: 'NEEDS_REVIEW', confidence: 0.1}],
		});

		await service.processTransactionJob([transaction.id]);

		expect(transaction.category).toBe('NEEDS_REVIEW');
		expect(transaction.categoryStatus).toBe('COMPLETED');
		expect(transaction.categorySource).toBe('AI');
		expect(transaction.categoryConfidence).toBe('0.1');
	});

	it('uses one web-search fallback for OTHER results in ordinary jobs', async () => {
		const transaction = createBankTransaction({id: 'ordinary-other-transaction'});
		const {service, provider} = createService({
			rows: [transaction],
			webSearchEnabled: true,
			providerResult: [{correlationId: transaction.id, category: 'OTHER', confidence: 0.5}],
			webSearchResult: [{correlationId: transaction.id, category: 'SHOPPING', confidence: 0.8}],
		});

		await service.processTransactionJob([transaction.id]);

		expect(provider.categorizeWithWebSearch).toHaveBeenCalledTimes(1);
		expect(transaction.category).toBe('SHOPPING');
		expect(transaction.categoryPromptVersion).toBe(BANK_TRANSACTION_CATEGORIZATION_WEB_SEARCH_PROMPT_VERSION);
	});

	it('retries an unsupported transportation guess when card merchant evidence is weak', async () => {
		const transaction = createBankTransaction({
			id: 'vending-transaction',
			counterpartyName: null,
			merchantCategoryCode: 'not-an-mcc',
			description: 'BEA, Google Pay Example Vending Cafe,PAS999 NR:TEST12345, 04.09.26/19:00 TESTVILLE',
		});
		const {service, provider} = createService({
			rows: [transaction],
			webSearchEnabled: true,
			providerResult: [{correlationId: transaction.id, category: 'TRANSPORTATION', confidence: 0.86}],
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

		await service.processTransactionJob([transaction.id]);

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

	it('normalizes a weak transportation guess to NEEDS_REVIEW when web search is disabled', async () => {
		const transaction = createBankTransaction({
			id: 'weak-transportation-transaction',
			counterpartyName: null,
			merchantCategoryCode: null,
			transactionType: 'CARD_PAYMENT',
		});
		const {service, provider} = createService({
			rows: [transaction],
			providerResult: [{correlationId: transaction.id, category: 'TRANSPORTATION', confidence: 0.86}],
		});

		await service.processTransactionJob([transaction.id]);

		expect(provider.categorizeWithWebSearch).not.toHaveBeenCalled();
		expect(transaction.category).toBe('NEEDS_REVIEW');
		expect(transaction.categoryStatus).toBe('COMPLETED');
		expect(transaction.categoryConfidence).toBe('0');
		expect(transaction.categoryPromptVersion).toBe(BANK_TRANSACTION_CATEGORIZATION_PROMPT_VERSION);
	});

	it('marks web Transportation without purchase evidence for review', async () => {
		const transaction = createBankTransaction({id: 'web-transportation-transaction'});
		const searchTrace = {
			queries: ['Opaque merchant'],
			sourceDomains: ['example.com'],
			evidenceType: 'MERCHANT_IDENTITY_ONLY' as const,
		};
		const {service} = createService({
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

		await service.processTransactionJob([transaction.id]);

		expect(transaction.category).toBe('NEEDS_REVIEW');
		expect(transaction.categoryStatus).toBe('COMPLETED');
		expect(transaction.categoryConfidence).toBe('0');
		expect(transaction.categorySearchTrace).toEqual(searchTrace);
	});

	it('normalizes web results with insufficient or conflicting evidence to NEEDS_REVIEW', async () => {
		const transaction = createBankTransaction({id: 'conflicting-web-result-transaction'});
		const {service} = createService({
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

		await service.processTransactionJob([transaction.id]);

		expect(transaction.category).toBe('NEEDS_REVIEW');
		expect(transaction.categoryStatus).toBe('COMPLETED');
		expect(transaction.categoryConfidence).toBe('0');
	});

	it('does not call web search when the fallback is disabled', async () => {
		const transaction = createBankTransaction({id: 'other-transaction'});
		const {service, provider} = createService({
			rows: [transaction],
			providerResult: [{correlationId: transaction.id, category: 'OTHER', confidence: 0.5}],
		});

		await service.processTransactionJob([transaction.id]);

		expect(provider.categorizeWithWebSearch).not.toHaveBeenCalled();
		expect(transaction.category).toBe('OTHER');
		expect(transaction.categoryPromptVersion).toBe(BANK_TRANSACTION_CATEGORIZATION_PROMPT_VERSION);
	});

	it('uses one web-search fallback for every OTHER result in a normal batch', async () => {
		const rows = Array.from({length: 6}, (_, index) =>
			createBankTransaction({id: `other-transaction-${index}`, counterpartyName: `Merchant ${index}`}),
		);
		const {service, provider} = createService({
			rows,
			webSearchEnabled: true,
			providerResult: rows.map(({id}) => ({correlationId: id, category: 'OTHER' as const, confidence: 0.5})),
			webSearchResult: rows.map(({id}) => ({correlationId: id, category: 'SHOPPING' as const, confidence: 0.8})),
		});

		await service.processTransactionJob(rows.map(({id}) => id));

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

	it('keeps valid results and terminalizes only failed web-search chunks', async () => {
		const rows = Array.from({length: 5}, (_, index) =>
			createBankTransaction({id: `other-transaction-${index}`, counterpartyName: `Merchant ${index}`}),
		);
		const failure = new BankTransactionCategorizationProviderError(
			'OpenAI categorization request failed (503).',
			true,
		);
		const {service, provider} = createService({
			rows,
			webSearchEnabled: true,
			providerResult: rows.map(({id}) => ({correlationId: id, category: 'OTHER' as const, confidence: 0.5})),
		});
		provider.categorizeWithWebSearch
			.mockImplementationOnce(async (inputs: readonly BankTransactionCategorizationWebSearchInput[]) =>
				inputs.map(({correlationId}) => ({correlationId, category: 'SHOPPING' as const, confidence: 0.75})),
			)
			.mockImplementationOnce(async (inputs: readonly BankTransactionCategorizationWebSearchInput[]) =>
				inputs.map(({correlationId}) => ({correlationId, category: 'SHOPPING' as const, confidence: 0.75})),
			)
			.mockImplementationOnce(async (inputs: readonly BankTransactionCategorizationWebSearchInput[]) =>
				inputs.map(({correlationId}) => ({correlationId, category: 'SHOPPING' as const, confidence: 0.75})),
			)
			.mockImplementationOnce(async (inputs: readonly BankTransactionCategorizationWebSearchInput[]) =>
				inputs.map(({correlationId}) => ({correlationId, category: 'SHOPPING' as const, confidence: 0.75})),
			)
			.mockRejectedValueOnce(failure);
		const logger = (service as unknown as {logger: {warn(message: string): void}}).logger;
		const warn = jest.spyOn(logger, 'warn').mockImplementation();

		try {
			await service.processTransactionJob(rows.map(({id}) => id));

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
			expect(rows[4].category).toBe('OTHER');
			expect(rows[4].categoryPromptVersion).toBe(
				BANK_TRANSACTION_CATEGORIZATION_WEB_SEARCH_FAILED_PROMPT_VERSION,
			);
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
		const {service, provider} = createService({rows: [transaction], webSearchEnabled: true});

		await service.processTransactionJob([transaction.id]);

		expect(provider.categorizeWithWebSearch).not.toHaveBeenCalled();
		expect(transaction.category).toBe('OTHER');
		expect(transaction.categoryPromptVersion).toBe(
			BANK_TRANSACTION_CATEGORIZATION_WEB_SEARCH_SKIPPED_PROMPT_VERSION,
		);
	});

	it('keeps the normal result when web-search fallback fails', async () => {
		const transaction = createBankTransaction({
			id: 'web-failure-transaction',
			counterpartyName: null,
			merchantCategoryCode: null,
		});
		const failure = new BankTransactionCategorizationProviderError(
			'OpenAI categorization request failed (503).',
			true,
		);
		const {service, provider} = createService({
			rows: [transaction],
			webSearchEnabled: true,
			webSearchError: failure,
			providerResult: [{correlationId: transaction.id, category: 'TRANSPORTATION', confidence: 0.86}],
		});
		const logger = (service as unknown as {logger: {warn(message: string): void}}).logger;
		const warn = jest.spyOn(logger, 'warn').mockImplementation();

		try {
			await expect(service.processTransactionJob([transaction.id])).resolves.toBeUndefined();
			expect(provider.categorizeWithWebSearch).toHaveBeenCalledTimes(1);
			expect(transaction.category).toBe('NEEDS_REVIEW');
			expect(transaction.categoryStatus).toBe('COMPLETED');
			expect(transaction.categoryConfidence).toBe('0');
			expect(transaction.categoryPromptVersion).toBe(
				BANK_TRANSACTION_CATEGORIZATION_WEB_SEARCH_FAILED_PROMPT_VERSION,
			);
			expect(warn).toHaveBeenCalledWith(
				'Transaction web-search fallback failed: BankTransactionCategorizationProviderError',
			);
		} finally {
			warn.mockRestore();
		}
	});

	it('preserves completed categories even when categorization hashes are missing', async () => {
		const transaction = createBankTransaction({
			category: 'OTHER',
			categoryStatus: 'COMPLETED',
			categorySource: 'AI',
			categoryConfidence: '1.000',
			categoryInputHash: null,
			categoryAppliedInputHash: null,
		});
		const {service, provider} = createService({rows: [transaction]});

		await service.processTransactionJob([transaction.id]);

		expect(provider.categorize).not.toHaveBeenCalled();
		expect(transaction.category).toBe('OTHER');
		expect(transaction.categoryStatus).toBe('COMPLETED');
		expect(transaction.categorySource).toBe('AI');
	});

	it('splits more than 50 unresolved records into bounded provider calls', async () => {
		const rows = Array.from({length: 51}, (_, index) =>
			createBankTransaction({id: `transaction-${index}`, providerTransactionId: `provider-${index}`}),
		);
		const {service, provider, queue} = createService({rows});

		await service.processTransactionJob(rows.map(({id}) => id));

		expect(provider.categorize).toHaveBeenCalledTimes(1);
		expect(provider.categorize.mock.calls[0][0]).toHaveLength(50);
		expect(queue.addBulk).toHaveBeenCalledTimes(1);
		expect(queue.addBulk.mock.calls[0][0][0].data.transactionIds).toHaveLength(1);
	});

	it('keeps ordinary categorization batches at the standard size when web search is enabled', async () => {
		const rows = Array.from({length: 51}, (_, index) =>
			createBankTransaction({id: `transaction-${index}`, providerTransactionId: `provider-${index}`}),
		);
		const {service, provider, queue} = createService({
			rows,
			webSearchEnabled: true,
			providerResult: rows.map(({id}) => ({
				correlationId: id,
				category: 'FOOD_AND_DRINK' as const,
				confidence: 0.9,
			})),
		});

		await service.processTransactionJob(rows.map(({id}) => id));

		expect(provider.categorize).toHaveBeenCalledTimes(1);
		expect(provider.categorize.mock.calls[0][0]).toHaveLength(BANK_TRANSACTION_CATEGORIZATION_BATCH_SIZE);
		expect(provider.categorizeWithWebSearch).not.toHaveBeenCalled();
		expect(queue.addBulk).toHaveBeenCalledTimes(1);
		expect(queue.addBulk.mock.calls[0][0]).toHaveLength(1);
		expect(queue.addBulk.mock.calls[0][0][0].data.transactionIds).toEqual([rows[50].id]);
	});

	it('keeps overflow jobs as ordinary transaction batches', async () => {
		const rows = Array.from({length: 51}, (_, index) =>
			createBankTransaction({id: `backfill-transaction-${index}`, providerTransactionId: `provider-${index}`}),
		);
		const {service, provider, queue} = createService({rows, webSearchEnabled: true});

		await service.processTransactionJob(rows.map(({id}) => id));

		expect(provider.categorizeWithWebSearch).toHaveBeenCalledTimes(50);
		expect(queue.addBulk).toHaveBeenCalledTimes(1);
		expect(queue.addBulk.mock.calls[0][0]).toHaveLength(1);
		expect(queue.addBulk.mock.calls[0][0][0].data).toEqual({transactionIds: [rows[50].id]});
	});

	it('applies a consistent manual category for the same merchant without calling the provider', async () => {
		const transaction = createBankTransaction({
			id: 'repeat-merchant',
			bankAccount: {bankConnection: {accountId: 'account-1'}} as never,
			description: 'BEA, Google Pay BCK*Example Rail 201,PAS123 NR:EX0001, 01.02.26/10:00 EXAMPLETOWN',
			counterpartyName: null,
		});
		const queryBuilder = createUpdateQueryBuilder();
		queryBuilder.getRawMany.mockResolvedValueOnce([
			{
				description: 'BEA, Betaalpas Example Rail 305,PAS123 NR:EX0002, 03.01.26/09:00 EXAMPLETOWN',
				counterpartyName: null,
				creditDebitIndicator: 'DBIT',
				category: 'TRANSPORTATION',
			},
		] as never);
		const {service, provider} = createService({rows: [transaction], queryBuilder});

		await service.processTransactionJob([transaction.id]);

		expect(provider.categorize).not.toHaveBeenCalled();
		expect(transaction).toMatchObject({
			category: 'TRANSPORTATION',
			categoryStatus: 'COMPLETED',
			categorySource: 'AI',
			categoryProvider: BANK_TRANSACTION_CATEGORIZATION_MANUAL_HISTORY_PROVIDER,
			categoryPromptVersion: BANK_TRANSACTION_CATEGORIZATION_MANUAL_HISTORY_PROMPT_VERSION,
		});
	});

	it('passes mixed manual categories for the same merchant to the provider', async () => {
		const transaction = createBankTransaction({
			id: 'mixed-merchant',
			bankAccount: {bankConnection: {accountId: 'account-1'}} as never,
			counterpartyName: 'Example Rides',
		});
		const history = [
			{
				description: 'Example Rides',
				counterpartyName: 'Example Rides',
				creditDebitIndicator: 'DBIT',
				category: 'FOOD_AND_DRINK',
			},
			{
				description: 'Example Rides',
				counterpartyName: 'Example Rides',
				creditDebitIndicator: 'DBIT',
				category: 'FOOD_AND_DRINK',
			},
			{
				description: 'Example Rides',
				counterpartyName: 'Example Rides',
				creditDebitIndicator: 'DBIT',
				category: 'TRANSPORTATION',
			},
			{
				description: 'Example Rides',
				counterpartyName: 'Example Rides',
				creditDebitIndicator: 'CRDT',
				category: 'REFUND',
			},
		];
		const queryBuilder = createUpdateQueryBuilder();
		queryBuilder.getRawMany.mockResolvedValueOnce(history as never);
		const {service, provider} = createService({rows: [transaction], queryBuilder});

		await service.processTransactionJob([transaction.id]);

		expect(provider.categorize).toHaveBeenCalledTimes(1);
		expect(provider.categorize.mock.calls[0][0][0].previousManualCategories).toEqual([
			{category: 'FOOD_AND_DRINK', count: 2},
			{category: 'TRANSPORTATION', count: 1},
		]);
		const [, categoryFilter] = queryBuilder.andWhere.mock.calls.find(([clause]) =>
			String(clause).includes('reusableCategories'),
		)!;
		expect(categoryFilter.reusableCategories).not.toContain('NEEDS_REVIEW');
		expect(categoryFilter.reusableCategories).toContain('TRANSPORTATION');
		expect(transaction.categoryPromptVersion).toBe(BANK_TRANSACTION_CATEGORIZATION_PROMPT_VERSION);
	});

	it('excludes manual rows from claims and provider calls', async () => {
		const transaction = createBankTransaction({
			category: 'SHOPPING',
			categoryStatus: 'COMPLETED',
			categorySource: 'MANUAL',
		});
		const {service, provider, repository} = createService({rows: [transaction]});

		await service.processTransactionJob([transaction.id]);

		expect(provider.categorize).not.toHaveBeenCalled();
		expect(repository.update).toHaveBeenCalledWith(
			expect.objectContaining({id: transaction.id, categoryInputHash: expect.anything()}),
			expect.objectContaining({categoryInputHash: expect.any(String)}),
		);
		expect(repository.update.mock.calls.some(([, values]) => values.categorySource === 'AI')).toBe(false);
	});

	it('does not categorize when a concurrent input hash update wins the race', async () => {
		const transaction = createBankTransaction();
		const {service, provider, repository} = createService({rows: [transaction]});
		repository.update.mockResolvedValueOnce({affected: 0});

		await service.processTransactionJob([transaction.id]);

		expect(provider.categorize).not.toHaveBeenCalled();
	});

	it('does not refresh the hash when a concurrent event reclassification wins the race', async () => {
		const transaction = createBankTransaction();
		const {service, provider, repository} = createService({rows: [transaction]});
		repository.update.mockImplementationOnce(async (criteria) => {
			expect(criteria).toEqual(expect.objectContaining({financialEventType: expect.anything()}));
			return {affected: 0};
		});

		await service.processTransactionJob([transaction.id]);

		expect(provider.categorize).not.toHaveBeenCalled();
	});

	it('does not reset a row after another worker claims it', async () => {
		const transaction = createBankTransaction({
			categoryStatus: 'PENDING',
			categorySource: 'LEGACY',
			categoryInputHash: 'old-input-hash',
			categoryAppliedInputHash: 'old-input-hash',
		});
		const queryBuilder = createUpdateQueryBuilder([{affected: 0}, {affected: 0}]);
		const {service, provider} = createService({rows: [transaction], queryBuilder});

		await service.processTransactionJob([transaction.id]);

		expect(provider.categorize).not.toHaveBeenCalled();
		expect(queryBuilder.andWhere).toHaveBeenCalledWith('"categoryStatus" = :expectedStatus', {
			expectedStatus: 'PENDING',
		});
	});

	it('does not apply a provider result after the claimed input hash changes', async () => {
		const transaction = createBankTransaction();
		const queryBuilder = createUpdateQueryBuilder([{affected: 1}, {affected: 0}]);
		const {service, provider, repository} = createService({rows: [transaction], queryBuilder});

		await service.processTransactionJob([transaction.id]);

		expect(provider.categorize).toHaveBeenCalledTimes(1);
		expect(queryBuilder.set).toHaveBeenCalledWith(expect.objectContaining({categoryStatus: 'PROCESSING'}));
		expect(transaction.categorySource).toBeNull();
		expect(transaction.category).toBeNull();
		expect(repository.update.mock.calls.some(([, values]) => values.categorySource === 'AI')).toBe(false);
	});

	it('marks retryable provider failures as failed and rethrows them', async () => {
		const transaction = createBankTransaction();
		const failure = new BankTransactionCategorizationProviderError(
			'OpenAI categorization request failed (503).',
			true,
		);
		const {service, repository} = createService({rows: [transaction], providerError: failure});

		await expect(service.processTransactionJob([transaction.id])).rejects.toBe(failure);
		const failedUpdate = repository.createQueryBuilder.mock.results.at(-1)?.value;
		expect(failedUpdate.set).toHaveBeenCalledWith(
			expect.objectContaining({categoryStatus: 'FAILED', categoryLastError: failure.message}),
		);
	});

	it('reclaims stale processing rows but leaves fresh claims alone', async () => {
		const stale = createBankTransaction({
			id: 'stale-transaction',
			categoryStatus: 'PROCESSING',
			categoryUpdatedAt: new Date(Date.now() - 16 * 60 * 1000),
		});
		const fresh = createBankTransaction({
			id: 'fresh-transaction',
			categoryStatus: 'PROCESSING',
			categoryUpdatedAt: new Date(Date.now() - 1 * 60 * 1000),
		});
		const {service, provider} = createService({rows: [stale, fresh]});

		await service.processTransactionJob([stale.id, fresh.id]);

		expect(provider.categorize).toHaveBeenCalledTimes(1);
		expect(
			provider.categorize.mock.calls[0][0].map(
				({correlationId}: BankTransactionCategorizationInput) => correlationId,
			),
		).toEqual([stale.id]);
	});
});
