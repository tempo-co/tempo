import {getQueueToken} from '@nestjs/bullmq';
import {INestApplication} from '@nestjs/common';
import {getRepositoryToken} from '@nestjs/typeorm';
import {JobType, Queue} from 'bullmq';
import {mkdtemp, rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {Server} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import TestAgent from 'supertest/lib/agent';
import {Repository} from 'typeorm';

import {ConfigurationService} from '@core/config/config.service';
import {BANK_TRANSACTION_CATEGORIZATION_QUEUE, CATEGORIZE_BANK_TRANSACTIONS_JOB} from '@core/queue/queue.constants';
import {BankTransaction} from '@modules/banking/bank-transaction.entity';
import {
	BANK_TRANSACTION_CATEGORIZATION_MANUAL_HISTORY_PROVIDER,
	BANK_TRANSACTION_CATEGORIZATION_WEB_SEARCH_FAILED_PROMPT_VERSION,
	BANK_TRANSACTION_CATEGORIZATION_WEB_SEARCH_PROMPT_VERSION,
} from '@modules/banking/categorization/bank-transaction-categorization.constants';
import {
	BankTransactionCategorizationProviderError,
	BankTransactionCategorizationUnavailableError,
} from '@modules/banking/categorization/bank-transaction-categorization.provider';
import type {
	BankTransactionCategorizationInput,
	BankTransactionCategorizationResult,
	BankTransactionCategorizationWebSearchInput,
	BankTransactionCategorizationWebSearchOutcome,
} from '@modules/banking/categorization/bank-transaction-categorization.types';
import {CategorizationPipeline} from '@modules/banking/categorization/categorization-pipeline.service';
import {CategorizationScheduler} from '@modules/banking/categorization/categorization-scheduler.service';
import {ClaudeBankTransactionCategorizationProvider} from '@modules/banking/categorization/providers/claude-bank-transaction-categorization.provider';

import {BankingFixtures} from '../../../scripts/seed-data/banking-fixtures';
import {VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD} from '../../../scripts/seed-data/seed.constants';
import {
	CATEGORIZATION_E2E_AI_TRANSACTION_ID,
	CATEGORIZATION_E2E_FAILURE_TRANSACTION_ID,
	CATEGORIZATION_E2E_MANUAL_HISTORY_TRANSACTION_ID,
	CATEGORIZATION_E2E_ONE_OFF_CHOICE_TRANSACTION_ID,
	CATEGORIZATION_E2E_ONE_OFF_MERCHANT_TRANSACTION_ID,
	CATEGORIZATION_E2E_OTHER_ACCOUNT_TRANSACTION_ID,
	CATEGORIZATION_E2E_REPEAT_AMOUNT_TRANSACTION_ID,
	CATEGORIZATION_E2E_REPEAT_MERCHANT_TRANSACTION_ID,
	CATEGORIZATION_E2E_SINGLE_AMOUNT_TRANSACTION_ID,
	CATEGORIZATION_E2E_WEB_TRANSACTION_ID,
	seedBankTransactionCategorizationData,
} from '../../setup/e2e-categorization-data';
import {enableAiCategorizationE2e, enableAiCategorizationWebSearchE2e, getApp, loginAgent} from '../../setup/e2e.setup';
import {createBankingOwner} from '../../utils/banking-utils';
import {waitFor} from '../../utils/wait-utils';

enableAiCategorizationE2e();
enableAiCategorizationWebSearchE2e();

const AI_CATEGORY = 'FOOD_AND_DRINK' as const;
const AI_CONFIDENCE = 0.875;
const WEB_CATEGORY = 'SHOPPING' as const;
const WEB_CONFIDENCE = 0.812;
let shouldFail = false;
let searchUnavailable = false;
/** Sends calls through the real provider, whose transport each test stubs with {@link useClaudeTransport}. */
let realProvider = false;

const realCategorize = ClaudeBankTransactionCategorizationProvider.prototype.categorize;
const realCategorizeWithWebSearch = ClaudeBankTransactionCategorizationProvider.prototype.categorizeWithWebSearch;

const categorizeSpy = jest
	.spyOn(ClaudeBankTransactionCategorizationProvider.prototype, 'categorize')
	.mockImplementation(async function (
		this: ClaudeBankTransactionCategorizationProvider,
		transactions: readonly BankTransactionCategorizationInput[],
		categories,
	): Promise<readonly BankTransactionCategorizationResult[]> {
		if (realProvider) return realCategorize.call(this, transactions, categories);
		if (shouldFail) {
			throw new BankTransactionCategorizationProviderError('synthetic provider failure', false);
		}
		return transactions.map(({correlationId}) => ({
			correlationId,
			category: correlationId === CATEGORIZATION_E2E_WEB_TRANSACTION_ID ? 'OTHER' : AI_CATEGORY,
			confidence: correlationId === CATEGORIZATION_E2E_WEB_TRANSACTION_ID ? 0.25 : AI_CONFIDENCE,
			provider: 'claude-api',
			model: 'test-model',
		}));
	});

const categorizeWithWebSearchSpy = jest
	.spyOn(ClaudeBankTransactionCategorizationProvider.prototype, 'categorizeWithWebSearch')
	.mockImplementation(async function (
		this: ClaudeBankTransactionCategorizationProvider,
		transactions: readonly BankTransactionCategorizationWebSearchInput[],
		categories,
	): Promise<readonly BankTransactionCategorizationWebSearchOutcome[]> {
		if (realProvider) return realCategorizeWithWebSearch.call(this, transactions, categories);
		if (searchUnavailable) throw new BankTransactionCategorizationUnavailableError();
		return transactions.map(({correlationId}) => ({
			correlationId,
			provider: 'claude-api',
			result: {
				correlationId,
				category: WEB_CATEGORY,
				confidence: WEB_CONFIDENCE,
				provider: 'claude-api',
				model: 'test-model',
			},
		}));
	});

type ProviderTransport = {client?: unknown; subscriptionSocket?: string};

/**
 * Replaces the real provider's Anthropic client with `create` and, with `bridge`, points its subscription route at a
 * loopback socket that answers every request with that status. Nothing leaves the process.
 */
async function useClaudeTransport(
	app: INestApplication,
	create: jest.Mock,
	bridge?: {status: number; body: object},
): Promise<{bridgeRequests: number; restore(): Promise<void>}> {
	const provider = app.get(ClaudeBankTransactionCategorizationProvider) as unknown as ProviderTransport;
	const previous = {client: provider.client, subscriptionSocket: provider.subscriptionSocket};
	const state = {bridgeRequests: 0, restore: async () => undefined};
	provider.client = {messages: {create}};
	realProvider = true;
	let close = async () => undefined;
	if (bridge) {
		const directory = await mkdtemp(join(tmpdir(), 'categorization-bridge-'));
		const socket = join(directory, 'bridge.sock');
		const server = createServer((request, response) => {
			request.resume();
			request.on('end', () => {
				state.bridgeRequests += 1;
				response.writeHead(bridge.status, {'content-type': 'application/json'});
				response.end(JSON.stringify(bridge.body));
			});
		});
		await new Promise<void>((resolve) => server.listen(socket, resolve));
		provider.subscriptionSocket = socket;
		close = async () => {
			await new Promise<void>((resolve) => server.close(() => resolve()));
			await rm(directory, {recursive: true, force: true});
		};
	}
	state.restore = async () => {
		realProvider = false;
		provider.client = previous.client;
		provider.subscriptionSocket = previous.subscriptionSocket;
		const closeBridge = close;
		close = async () => undefined;
		await closeBridge();
	};
	return state;
}

describe('Bank transaction categorization integration', () => {
	jest.setTimeout(30_000);

	let app: INestApplication<Server>;
	let httpServer: Server;
	let verifiedAgent: TestAgent;
	let bankTransactionRepository: Repository<BankTransaction>;

	function resetFailureFixture(overrides: Pick<Partial<BankTransaction>, 'categorySearchTrace'> = {}) {
		return bankTransactionRepository.update(CATEGORIZATION_E2E_FAILURE_TRANSACTION_ID, {
			category: null,
			categoryStatus: 'PENDING',
			categorySource: null,
			categoryConfidence: null,
			categoryInputHash: null,
			categoryAppliedInputHash: null,
			categoryProvider: null,
			categoryModel: null,
			categoryPromptVersion: null,
			categoryUpdatedAt: null,
			categoryLastError: null,
			...overrides,
		});
	}

	beforeAll(async () => {
		app = getApp();
		await seedBankTransactionCategorizationData(app);
		httpServer = app.getHttpServer();

		const configurationService = app.get(ConfigurationService);
		expect(configurationService.get('AI_CATEGORIZATION_ENABLED')).toBe(true);
		expect(configurationService.get('AI_CATEGORIZATION_WEB_SEARCH_ENABLED')).toBe(true);
		expect(configurationService.get('ANTHROPIC_API_KEY')).toBeTruthy();

		bankTransactionRepository = app.get<Repository<BankTransaction>>(getRepositoryToken(BankTransaction));
		verifiedAgent = await loginAgent(httpServer, VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);
	});

	beforeEach(() => {
		shouldFail = false;
		searchUnavailable = false;
		realProvider = false;
		categorizeSpy.mockClear();
		categorizeWithWebSearchSpy.mockClear();
	});

	afterAll(() => {
		shouldFail = false;
		realProvider = false;
		categorizeWithWebSearchSpy.mockRestore();
		categorizeSpy.mockRestore();
	});

	it('runs the real HTTP, database, queue, worker, and persistence path with a mocked provider response', async () => {
		const categorizationService = app.get(CategorizationScheduler);
		await categorizationService.enqueueForTransactions([CATEGORIZATION_E2E_AI_TRANSACTION_ID]);

		const response = await waitFor(
			() => verifiedAgent.get(`/bank-transactions/${CATEGORIZATION_E2E_AI_TRANSACTION_ID}`),
			(value) => value.status === 200 && value.body.categoryStatus === 'COMPLETED',
		);

		expect(response.body).toMatchObject({
			id: CATEGORIZATION_E2E_AI_TRANSACTION_ID,
			category: AI_CATEGORY,
			categoryStatus: 'COMPLETED',
			categorySource: 'AI',
			categoryConfidence: String(AI_CONFIDENCE),
		});
		expect(categorizeSpy).toHaveBeenCalledTimes(1);
		expect(categorizeSpy.mock.calls[0][0][0]).toMatchObject({
			correlationId: CATEGORIZATION_E2E_AI_TRANSACTION_ID,
			amount: '-47.25000000',
			currency: 'EUR',
			direction: 'EXPENSE',
			description: 'Lantern Books',
			counterpartyName: 'Lantern Books',
			bankTransactionCode: 'PMNT',
			bankTransactionSubCode: 'CARD',
			merchantCategoryCode: '5814',
		});
		expect(categorizeSpy.mock.calls[0][1]).toHaveLength(19);

		const persisted = await bankTransactionRepository.findOneByOrFail({id: CATEGORIZATION_E2E_AI_TRANSACTION_ID});
		expect(persisted).toMatchObject({
			category: AI_CATEGORY,
			categoryStatus: 'COMPLETED',
			categorySource: 'AI',
			categoryConfidence: String(AI_CONFIDENCE),
			categoryProvider: 'claude-api',
			categoryModel: 'test-model',
		});
	});

	it("never applies the owner's manual category to another row; it is only a hint for the model", async () => {
		// Both accounts' rows go through one batch, as reconciliation does across users.
		const categorizationService = app.get(CategorizationScheduler);
		await categorizationService.enqueueForTransactions([
			CATEGORIZATION_E2E_REPEAT_MERCHANT_TRANSACTION_ID,
			CATEGORIZATION_E2E_OTHER_ACCOUNT_TRANSACTION_ID,
		]);

		const [repeatRow, otherAccountRow] = await Promise.all(
			[CATEGORIZATION_E2E_REPEAT_MERCHANT_TRANSACTION_ID, CATEGORIZATION_E2E_OTHER_ACCOUNT_TRANSACTION_ID].map(
				(id) =>
					waitFor(
						() => bankTransactionRepository.findOneByOrFail({id}),
						(value) => value.categoryStatus === 'COMPLETED',
					),
			),
		);
		for (const row of [repeatRow, otherAccountRow]) {
			expect(row).toMatchObject({category: AI_CATEGORY, categorySource: 'AI'});
			expect(row.categoryProvider).not.toBe(BANK_TRANSACTION_CATEGORIZATION_MANUAL_HISTORY_PROVIDER);
		}

		// Each row's hint carries only its own owner's choices, with the amount, currency and date of each.
		const inputs = new Map(
			categorizeSpy.mock.calls.flatMap(([transactions]) =>
				transactions.map((input) => [input.correlationId, input]),
			),
		);
		expect(inputs.get(CATEGORIZATION_E2E_REPEAT_MERCHANT_TRANSACTION_ID)?.previousManualCategories).toEqual([
			{
				category: 'TRANSPORTATION',
				count: 1,
				recentExamples: [{amount: '-20.00', currency: 'EUR', date: '2026-09-04'}],
			},
		]);
		expect(inputs.get(CATEGORIZATION_E2E_OTHER_ACCOUNT_TRANSACTION_ID)?.previousManualCategories).toEqual([
			{
				category: 'ENTERTAINMENT',
				count: 1,
				recentExamples: [{amount: '-20.00', currency: 'EUR', date: '2026-09-04'}],
			},
		]);
	});

	it('sends earlier same-amount payments to the same payee only when there are at least two', async () => {
		const ids = [CATEGORIZATION_E2E_REPEAT_AMOUNT_TRANSACTION_ID, CATEGORIZATION_E2E_SINGLE_AMOUNT_TRANSACTION_ID];
		await app.get(CategorizationScheduler).enqueueForTransactions(ids);
		await Promise.all(
			ids.map((id) =>
				waitFor(
					() => bankTransactionRepository.findOneByOrFail({id}),
					(row) => row.categoryStatus === 'COMPLETED',
				),
			),
		);
		const inputs = new Map(
			categorizeSpy.mock.calls.flatMap(([transactions]) =>
				transactions.map((input) => [input.correlationId, input]),
			),
		);
		// Same payee, amount and currency, earlier than the row: the owner's picks newest first, then the two oldest AI
		// rows per category, with each payment's sanitized note.
		const noNote = (date: string, category: string) => ({date, category, source: 'AI', text: 'To Example H'});
		const picked = (date: string) => ({
			date,
			category: 'HOUSING_AND_UTILITIES',
			source: 'MANUAL',
			text: 'To Example H',
		});
		expect(inputs.get(CATEGORIZATION_E2E_REPEAT_AMOUNT_TRANSACTION_ID)?.sameAmountPayments).toEqual([
			picked('2026-08-28'),
			picked('2026-08-10'),
			noNote('2026-05-01', 'TRANSFER_OUT'),
			noNote('2026-05-02', 'TRANSFER_OUT'),
			{
				date: '2026-06-28',
				category: 'HOUSING_AND_UTILITIES',
				source: 'AI',
				text: 'rent july IBAN [REDACTED] | To Example H',
			},
			noNote('2026-07-01', 'HOUSING_AND_UTILITIES'),
		]);
		expect(inputs.get(CATEGORIZATION_E2E_SINGLE_AMOUNT_TRANSACTION_ID)?.sameAmountPayments).toBeUndefined();
	});

	it("leaves the owner's one-off manual choice out of the next row's hint", async () => {
		await app
			.get(CategorizationScheduler)
			.enqueueForTransactions([CATEGORIZATION_E2E_ONE_OFF_MERCHANT_TRANSACTION_ID]);

		const row = await waitFor(
			() => bankTransactionRepository.findOneByOrFail({id: CATEGORIZATION_E2E_ONE_OFF_MERCHANT_TRANSACTION_ID}),
			(value) => value.categoryStatus === 'COMPLETED',
		);
		expect(row).toMatchObject({category: AI_CATEGORY, categorySource: 'AI'});
		// The one-off choice belongs to the same merchant, so without the filter it would have been the hint.
		const oneOffChoice = await bankTransactionRepository.findOneByOrFail({
			id: CATEGORIZATION_E2E_ONE_OFF_CHOICE_TRANSACTION_ID,
		});
		expect(oneOffChoice).toMatchObject({
			category: 'HEALTH',
			categorySource: 'MANUAL',
			merchantKey: row.merchantKey,
		});
		const input = categorizeSpy.mock.calls
			.flatMap(([transactions]) => transactions)
			.find(({correlationId}) => correlationId === CATEGORIZATION_E2E_ONE_OFF_MERCHANT_TRANSACTION_ID);
		expect(input).toMatchObject({correlationId: CATEGORIZATION_E2E_ONE_OFF_MERCHANT_TRANSACTION_ID});
		expect(input).not.toHaveProperty('previousManualCategories');
	});

	it('changes no other row when a correction is saved without selecting it', async () => {
		// The previous test left the repeat row categorized by the model.
		await verifiedAgent
			.patch(`/bank-transactions/${CATEGORIZATION_E2E_MANUAL_HISTORY_TRANSACTION_ID}/category`)
			.send({category: 'TRAVEL'})
			.expect(200);

		const sibling = await bankTransactionRepository.findOneByOrFail({
			id: CATEGORIZATION_E2E_REPEAT_MERCHANT_TRANSACTION_ID,
		});
		expect(sibling).toMatchObject({category: AI_CATEGORY, categorySource: 'AI', categoryStatus: 'COMPLETED'});
		expect(categorizeSpy).not.toHaveBeenCalled();

		// When the sibling is categorized again, as a newly synced row would be, the model decides; the owner's TRAVEL
		// choice is only its hint and is not copied.
		await bankTransactionRepository.update(
			{id: CATEGORIZATION_E2E_REPEAT_MERCHANT_TRANSACTION_ID},
			{categoryStatus: 'PENDING'},
		);
		await app
			.get(CategorizationScheduler)
			.enqueueForTransactions([CATEGORIZATION_E2E_REPEAT_MERCHANT_TRANSACTION_ID]);
		const recategorized = await waitFor(
			() => bankTransactionRepository.findOneByOrFail({id: CATEGORIZATION_E2E_REPEAT_MERCHANT_TRANSACTION_ID}),
			(value) => value.categoryStatus === 'COMPLETED',
		);
		expect(recategorized).toMatchObject({category: AI_CATEGORY, categorySource: 'AI'});
		expect(recategorized.categoryProvider).not.toBe(BANK_TRANSACTION_CATEGORIZATION_MANUAL_HISTORY_PROVIDER);
		expect(categorizeSpy).toHaveBeenCalledTimes(1);
		expect(categorizeSpy.mock.calls[0][0][0].previousManualCategories).toEqual([
			{category: 'TRAVEL', count: 1, recentExamples: [{amount: '-20.00', currency: 'EUR', date: '2026-09-04'}]},
		]);
		categorizeSpy.mockClear();

		// Put the owner's original choice back for the next test.
		await verifiedAgent
			.patch(`/bank-transactions/${CATEGORIZATION_E2E_MANUAL_HISTORY_TRANSACTION_ID}/category`)
			.send({category: 'TRANSPORTATION'})
			.expect(200);
	});

	it('applies a previewed manual correction only to the rows the owner selected', async () => {
		const preview = await verifiedAgent
			.get(`/bank-transactions/${CATEGORIZATION_E2E_MANUAL_HISTORY_TRANSACTION_ID}/category-impact`)
			.query({category: 'TRAVEL'})
			.expect(200);
		expect(preview.body).toMatchObject({action: 'APPLY', category: 'TRAVEL', total: 1});
		expect(preview.body.transactions).toEqual([
			expect.objectContaining({
				id: CATEGORIZATION_E2E_REPEAT_MERCHANT_TRANSACTION_ID,
				category: AI_CATEGORY,
				categorySource: 'AI',
			}),
		]);

		await verifiedAgent
			.patch(`/bank-transactions/${CATEGORIZATION_E2E_MANUAL_HISTORY_TRANSACTION_ID}/category`)
			.send({category: 'TRAVEL', applyToTransactionIds: [CATEGORIZATION_E2E_REPEAT_MERCHANT_TRANSACTION_ID]})
			.expect(200);

		const sibling = await bankTransactionRepository.findOneByOrFail({
			id: CATEGORIZATION_E2E_REPEAT_MERCHANT_TRANSACTION_ID,
		});
		expect(sibling).toMatchObject({category: 'TRAVEL', categorySource: 'HISTORY', categoryStatus: 'COMPLETED'});
		expect(sibling.categoryAppliedInputHash).toBe(sibling.categoryInputHash);
		const otherAccountRow = await bankTransactionRepository.findOneByOrFail({
			id: CATEGORIZATION_E2E_OTHER_ACCOUNT_TRANSACTION_ID,
		});
		// The other account's row keeps what the model gave it in the first test.
		expect(otherAccountRow).toMatchObject({category: AI_CATEGORY, categorySource: 'AI'});
		expect(categorizeSpy).not.toHaveBeenCalled();
	});

	it('sends history-filled rows back to the model when no reusable manual choice is left', async () => {
		// The previous test left the repeat row filled from the owner's manual TRAVEL choice.
		const preview = await verifiedAgent
			.get(`/bank-transactions/${CATEGORIZATION_E2E_MANUAL_HISTORY_TRANSACTION_ID}/category-impact`)
			.query({category: 'NEEDS_REVIEW'})
			.expect(200);
		expect(preview.body).toMatchObject({action: 'RECHECK', category: null, total: 1});
		expect(preview.body.transactions).toEqual([
			expect.objectContaining({id: CATEGORIZATION_E2E_REPEAT_MERCHANT_TRANSACTION_ID, category: 'TRAVEL'}),
		]);
		expect(categorizeSpy).not.toHaveBeenCalled();

		await verifiedAgent
			.patch(`/bank-transactions/${CATEGORIZATION_E2E_MANUAL_HISTORY_TRANSACTION_ID}/category`)
			.send({
				category: 'NEEDS_REVIEW',
				applyToTransactionIds: [CATEGORIZATION_E2E_REPEAT_MERCHANT_TRANSACTION_ID],
			})
			.expect(200);

		const sibling = await waitFor(
			() => bankTransactionRepository.findOneByOrFail({id: CATEGORIZATION_E2E_REPEAT_MERCHANT_TRANSACTION_ID}),
			(value) => value.categoryStatus === 'COMPLETED' && value.categorySource === 'AI',
		);
		expect(sibling.category).toBe(AI_CATEGORY);
		expect(categorizeSpy).toHaveBeenCalledTimes(1);
		expect(categorizeSpy.mock.calls[0][0].map(({correlationId}) => correlationId)).toEqual([
			CATEGORIZATION_E2E_REPEAT_MERCHANT_TRANSACTION_ID,
		]);
	});

	it('runs one normal pass and one web-search fallback for an OTHER result', async () => {
		const categorizationService = app.get(CategorizationScheduler);
		await categorizationService.enqueueForTransactions([CATEGORIZATION_E2E_WEB_TRANSACTION_ID]);

		const response = await waitFor(
			() => verifiedAgent.get(`/bank-transactions/${CATEGORIZATION_E2E_WEB_TRANSACTION_ID}`),
			(value) =>
				value.status === 200 &&
				value.body.categoryStatus === 'COMPLETED' &&
				value.body.category === WEB_CATEGORY,
		);

		expect(response.body).toMatchObject({
			id: CATEGORIZATION_E2E_WEB_TRANSACTION_ID,
			category: WEB_CATEGORY,
			categoryStatus: 'COMPLETED',
			categorySource: 'AI',
			categoryConfidence: String(WEB_CONFIDENCE),
		});
		expect(categorizeSpy).toHaveBeenCalledTimes(1);
		expect(categorizeWithWebSearchSpy).toHaveBeenCalledTimes(1);
		expect(categorizeWithWebSearchSpy.mock.calls[0][0]).toEqual([
			{
				correlationId: CATEGORIZATION_E2E_WEB_TRANSACTION_ID,
				amount: '-23.00000000',
				currency: 'EUR',
				direction: 'EXPENSE',
				transactionType: 'OTHER',
				merchantName: 'Synthetic ambiguous merchant',
				merchantLocation: null,
				searchQuery: 'Synthetic ambiguous merchant',
				merchantCategoryCode: null,
			},
		]);

		const persisted = await bankTransactionRepository.findOneByOrFail({id: CATEGORIZATION_E2E_WEB_TRANSACTION_ID});
		expect(persisted).toMatchObject({
			category: WEB_CATEGORY,
			categorySource: 'AI',
			categoryPromptVersion: BANK_TRANSACTION_CATEGORIZATION_WEB_SEARCH_PROMPT_VERSION,
		});
	});

	it('sends a row to review, without searching again, when its search used another query', async () => {
		const transport = await useClaudeTransport(
			app,
			jest.fn().mockResolvedValue({
				stop_reason: 'end_turn',
				usage: {server_tool_use: {web_search_requests: 1}},
				content: [
					{type: 'server_tool_use', name: 'web_search', input: {query: 'Synthetic other query'}},
					{type: 'web_search_tool_result', content: []},
					{
						type: 'text',
						text: '{"classifications":[{"correlationId":"0","category":"SHOPPING","confidence":0.9,"evidenceType":"PURCHASE_CONTEXT"}]}',
					},
				],
			}),
		);
		try {
			categorizeSpy.mockImplementationOnce(async (transactions) =>
				transactions.map(({correlationId}) => ({
					correlationId,
					category: 'OTHER' as const,
					confidence: 0.25,
					provider: 'claude-api',
					model: 'test-model',
				})),
			);
			await bankTransactionRepository.update(CATEGORIZATION_E2E_WEB_TRANSACTION_ID, {
				categoryStatus: 'PENDING',
				categoryAppliedInputHash: null,
			});
			await app.get(CategorizationScheduler).enqueueForTransactions([CATEGORIZATION_E2E_WEB_TRANSACTION_ID]);

			const reviewed = await waitFor(
				() => bankTransactionRepository.findOneByOrFail({id: CATEGORIZATION_E2E_WEB_TRANSACTION_ID}),
				(row) => row.categoryStatus === 'COMPLETED',
			);
			expect(reviewed).toMatchObject({
				category: 'NEEDS_REVIEW',
				categoryConfidence: '0.000',
				categorySource: 'AI',
				categoryProvider: 'claude-api',
				categoryPromptVersion: BANK_TRANSACTION_CATEGORIZATION_WEB_SEARCH_FAILED_PROMPT_VERSION,
				categorySearchTrace: {queries: [], sourceDomains: [], evidenceType: 'INSUFFICIENT'},
				categoryLastError: null,
			});
			expect(categorizeWithWebSearchSpy).toHaveBeenCalledTimes(1);
		} finally {
			await transport.restore();
		}
	});

	it('keeps a row pending when its web search is unavailable on both routes, then completes it on retry', async () => {
		searchUnavailable = true;
		const categorizationService = app.get(CategorizationScheduler);
		await bankTransactionRepository.update(CATEGORIZATION_E2E_WEB_TRANSACTION_ID, {
			category: null,
			categoryStatus: 'PENDING',
			categorySource: null,
			categoryConfidence: null,
			categoryAppliedInputHash: null,
			categoryProvider: null,
			categoryModel: null,
			categoryPromptVersion: null,
			categorySearchTrace: null,
			categoryLastError: null,
		});
		await expect(
			app.get(CategorizationPipeline).processTransactionJob([CATEGORIZATION_E2E_WEB_TRANSACTION_ID]),
		).rejects.toThrow(BankTransactionCategorizationUnavailableError);
		const pending = await bankTransactionRepository.findOneByOrFail({id: CATEGORIZATION_E2E_WEB_TRANSACTION_ID});
		expect(pending).toMatchObject({
			category: null,
			categoryStatus: 'PENDING',
			categoryLastError: 'Claude categorization is temporarily unavailable.',
		});
		expect(categorizeWithWebSearchSpy).toHaveBeenCalledTimes(1);

		searchUnavailable = false;
		await categorizationService.reconcilePendingTransactions({includeFailed: false});
		const recovered = await waitFor(
			() => bankTransactionRepository.findOneByOrFail({id: CATEGORIZATION_E2E_WEB_TRANSACTION_ID}),
			(row) => row.categoryStatus === 'COMPLETED',
		);
		expect(recovered).toMatchObject({
			category: WEB_CATEGORY,
			categoryPromptVersion: BANK_TRANSACTION_CATEGORIZATION_WEB_SEARCH_PROMPT_VERSION,
			categoryLastError: null,
		});
	});

	it('keeps a row pending while the API rate-limits it, with no bridge, and retries the job a minute later', async () => {
		const transport = await useClaudeTransport(app, jest.fn().mockRejectedValue({status: 429}));
		const categorizationService = app.get(CategorizationScheduler);
		const queue = app.get<Queue>(getQueueToken(BANK_TRANSACTION_CATEGORIZATION_QUEUE));
		await resetFailureFixture({categorySearchTrace: null});
		const rowJobs = async (states: JobType[]) =>
			(await queue.getJobs(states)).filter(
				(job) =>
					job.name === CATEGORIZE_BANK_TRANSACTIONS_JOB &&
					(job.data as {transactionIds: string[]}).transactionIds.includes(
						CATEGORIZATION_E2E_FAILURE_TRANSACTION_ID,
					),
			);
		const modelCallsForRow = () =>
			categorizeSpy.mock.calls.filter(([inputs]) =>
				inputs.some(({correlationId}) => correlationId === CATEGORIZATION_E2E_FAILURE_TRANSACTION_ID),
			).length;
		try {
			await categorizationService.enqueueForTransactions([CATEGORIZATION_E2E_FAILURE_TRANSACTION_ID]);
			const [retry] = await waitFor(
				() => rowJobs(['delayed']),
				(jobs) => jobs.length === 1,
			);
			expect(retry.delay).toBe(60_000);
			expect(retry.attemptsMade).toBe(1);
			const unavailable = await bankTransactionRepository.findOneByOrFail({
				id: CATEGORIZATION_E2E_FAILURE_TRANSACTION_ID,
			});
			expect(unavailable).toMatchObject({
				category: null,
				categoryStatus: 'PENDING',
				categorySource: null,
				categoryLastError: 'Claude categorization is temporarily unavailable.',
			});
			expect(modelCallsForRow()).toBe(1);
			expect(categorizeWithWebSearchSpy).not.toHaveBeenCalled();
			const pendingResponse = await verifiedAgent
				.get(`/bank-transactions/${CATEGORIZATION_E2E_FAILURE_TRANSACTION_ID}`)
				.expect(200);
			expect(pendingResponse.body).toMatchObject({category: null, categoryStatus: 'PENDING'});

			// The hourly sweep can run while the job waits; it may queue its own batch, which waits too.
			await categorizationService.reconcilePendingTransactions({includeFailed: false});
			await waitFor(
				() => rowJobs(['waiting', 'active', 'prioritized']),
				(jobs) => jobs.length === 0,
			);

			await transport.restore();
			categorizeSpy.mockClear();
			// Stands in for the minute passing.
			await Promise.all((await rowJobs(['delayed'])).map((job) => job.promote()));
			const recovered = await waitFor(
				() => bankTransactionRepository.findOneByOrFail({id: CATEGORIZATION_E2E_FAILURE_TRANSACTION_ID}),
				(row) => row.categoryStatus === 'COMPLETED',
			);
			expect(recovered).toMatchObject({
				category: AI_CATEGORY,
				categorySource: 'AI',
				categoryProvider: 'claude-api',
				categoryModel: 'test-model',
				categoryLastError: null,
			});
			await waitFor(
				() => rowJobs(['delayed', 'waiting', 'active', 'prioritized']),
				(jobs) => jobs.length === 0,
			);
			expect(modelCallsForRow()).toBe(1);
		} finally {
			await transport.restore();
			// The sweep's own batches for other pending rows would otherwise run during later tests.
			const leftover = await queue.getJobs(['delayed']);
			await Promise.all(
				leftover.filter((job) => job.name === CATEGORIZE_BANK_TRANSACTIONS_JOB).map((job) => job.remove()),
			);
		}
	});

	it.each([
		[
			'a reply cut off at the token limit',
			() =>
				jest.fn().mockResolvedValue({
					stop_reason: 'max_tokens',
					usage: {server_tool_use: {web_search_requests: 0}},
					content: [{type: 'text', text: '{"classifications":[{"correlationId":"0","cate'}],
				}),
			undefined,
			'Claude returned an invalid categorization response.',
		],
		[
			'a request the bridge rejects',
			() => jest.fn().mockRejectedValue({status: 400}),
			{status: 400, body: {error: 'invalid_request'}},
			'Claude categorization request failed.',
		],
	])(
		'retries %s twice within seconds, then leaves the row failed for the hourly sweep to skip',
		async (_case, create, bridge, lastError) => {
			const queue = app.get<Queue>(getQueueToken(BANK_TRANSACTION_CATEGORIZATION_QUEUE));
			const categorizationService = app.get(CategorizationScheduler);
			const transport = await useClaudeTransport(app, create(), bridge);
			try {
				await resetFailureFixture();
				await categorizationService.enqueueForTransactions([CATEGORIZATION_E2E_FAILURE_TRANSACTION_ID]);

				await waitFor(
					async () => categorizeSpy.mock.calls.length,
					(calls) => calls === 3,
				);
				await waitFor(
					async () => (await queue.getJobs(['delayed', 'waiting', 'active'])).length,
					(count) => count === 0,
				);
				const persisted = await bankTransactionRepository.findOneByOrFail({
					id: CATEGORIZATION_E2E_FAILURE_TRANSACTION_ID,
				});
				expect(persisted).toMatchObject({
					category: null,
					categoryStatus: 'FAILED',
					categoryLastError: lastError,
				});
				expect(transport.bridgeRequests).toBe(bridge ? 3 : 0);

				await transport.restore();
				await categorizationService.reconcilePendingTransactions({includeFailed: false});
				const queued = await queue.getJobs(['delayed', 'waiting', 'active', 'prioritized']);
				expect(
					queued.filter((job) =>
						(job.data as {transactionIds?: string[]}).transactionIds?.includes(
							CATEGORIZATION_E2E_FAILURE_TRANSACTION_ID,
						),
					),
				).toEqual([]);
				expect(
					categorizeSpy.mock.calls.filter(([inputs]) =>
						inputs.some(({correlationId}) => correlationId === CATEGORIZATION_E2E_FAILURE_TRANSACTION_ID),
					),
				).toHaveLength(3);
			} finally {
				await transport.restore();
				const leftover = await queue.getJobs(['delayed', 'waiting']);
				await Promise.all(
					leftover.filter((job) => job.name === CATEGORIZE_BANK_TRANSACTIONS_JOB).map((job) => job.remove()),
				);
			}
		},
	);

	it('claims only rows waiting for the model, including a claim another worker abandoned', async () => {
		const {bankAccount} = await createBankingOwner(app, {baseCurrency: 'EUR'});
		const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);
		const row = (description: string, values: Partial<BankTransaction>) => ({
			description,
			counterpartyName: description,
			amount: '-4.20',
			...values,
		});
		const [pending, failed, abandoned, working, manual, completed] = await new BankingFixtures(
			app,
		).createTransactions(bankAccount, [
			row('Example Claim Pending', {categoryStatus: 'PENDING'}),
			row('Example Claim Failed', {categoryStatus: 'FAILED'}),
			row('Example Claim Abandoned', {categoryStatus: 'PROCESSING', categoryUpdatedAt: minutesAgo(16)}),
			row('Example Claim Working', {categoryStatus: 'PROCESSING', categoryUpdatedAt: minutesAgo(1)}),
			row('Example Claim Manual', {category: 'SHOPPING', categoryStatus: 'COMPLETED', categorySource: 'MANUAL'}),
			row('Example Claim Completed', {category: 'TRAVEL', categoryStatus: 'COMPLETED', categorySource: 'AI'}),
		]);

		await app
			.get(CategorizationPipeline)
			.processTransactionJob([pending, failed, abandoned, working, manual, completed].map(({id}) => id));

		expect(categorizeSpy).toHaveBeenCalledTimes(1);
		expect(categorizeSpy.mock.calls[0][0].map(({correlationId}) => correlationId)).toEqual([
			pending.id,
			failed.id,
			abandoned.id,
		]);
		const rows = await bankTransactionRepository.findBy({bankAccountId: bankAccount.id});
		const byId = new Map(rows.map((transaction) => [transaction.id, transaction]));
		for (const {id} of [pending, failed, abandoned])
			expect(byId.get(id)).toMatchObject({
				category: AI_CATEGORY,
				categoryStatus: 'COMPLETED',
				categorySource: 'AI',
			});
		expect(byId.get(working.id)).toMatchObject({category: null, categoryStatus: 'PROCESSING'});
		expect(byId.get(manual.id)).toMatchObject({category: 'SHOPPING', categorySource: 'MANUAL'});
		expect(byId.get(completed.id)).toMatchObject({category: 'TRAVEL', categorySource: 'AI'});
	});

	it('persists a provider failure through the real worker path without calling an external provider', async () => {
		shouldFail = true;
		try {
			await resetFailureFixture();
			const categorizationService = app.get(CategorizationScheduler);
			await categorizationService.enqueueForTransactions([CATEGORIZATION_E2E_FAILURE_TRANSACTION_ID]);

			const response = await waitFor(
				() => verifiedAgent.get(`/bank-transactions/${CATEGORIZATION_E2E_FAILURE_TRANSACTION_ID}`),
				(value) => value.status === 200 && value.body.categoryStatus === 'FAILED',
			);

			expect(response.body).toMatchObject({
				id: CATEGORIZATION_E2E_FAILURE_TRANSACTION_ID,
				category: null,
				categoryStatus: 'FAILED',
				categorySource: null,
			});
			expect(categorizeSpy).toHaveBeenCalledTimes(1);
			const persisted = await bankTransactionRepository.findOneByOrFail({
				id: CATEGORIZATION_E2E_FAILURE_TRANSACTION_ID,
			});
			expect(persisted.categoryLastError).toBe('Transaction categorization failed.');
		} finally {
			shouldFail = false;
		}
	});
});
