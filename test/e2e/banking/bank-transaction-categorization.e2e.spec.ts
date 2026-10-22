import {getQueueToken} from '@nestjs/bullmq';
import {INestApplication} from '@nestjs/common';
import {getRepositoryToken} from '@nestjs/typeorm';
import {JobType, Queue} from 'bullmq';
import {Server} from 'node:net';
import TestAgent from 'supertest/lib/agent';
import {Repository} from 'typeorm';

import {ConfigurationService} from '@core/config/config.service';
import {BANK_TRANSACTION_CATEGORIZATION_QUEUE, CATEGORIZE_BANK_TRANSACTIONS_JOB} from '@core/queue/queue.constants';
import {BankTransaction} from '@modules/banking/bank-transaction.entity';
import {
	BANK_TRANSACTION_CATEGORIZATION_MANUAL_HISTORY_PROVIDER,
	BANK_TRANSACTION_CATEGORIZATION_PROVIDER_NAME,
	BANK_TRANSACTION_CATEGORIZATION_WEB_SEARCH_PROMPT_VERSION,
} from '@modules/banking/categorization/bank-transaction-categorization.constants';
import {
	BankTransactionCategorizationProviderError,
	BankTransactionCategorizationUnavailableError,
} from '@modules/banking/categorization/bank-transaction-categorization.provider';
import {BankTransactionCategorizationService} from '@modules/banking/categorization/bank-transaction-categorization.service';
import type {
	BankTransactionCategorizationInput,
	BankTransactionCategorizationResult,
	BankTransactionCategorizationWebSearchInput,
} from '@modules/banking/categorization/bank-transaction-categorization.types';
import {ClaudeBankTransactionCategorizationProvider} from '@modules/banking/categorization/providers/claude-bank-transaction-categorization.provider';

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

enableAiCategorizationE2e();
enableAiCategorizationWebSearchE2e();

const AI_CATEGORY = 'FOOD_AND_DRINK' as const;
const AI_CONFIDENCE = 0.875;
const WEB_CATEGORY = 'SHOPPING' as const;
const WEB_CONFIDENCE = 0.812;
let shouldFail = false;
let routesUnavailable = false;
let searchUnavailable = false;
let retryableFailure = false;

const categorizeSpy = jest
	.spyOn(ClaudeBankTransactionCategorizationProvider.prototype, 'categorize')
	.mockImplementation(
		async (
			transactions: readonly BankTransactionCategorizationInput[],
		): Promise<readonly BankTransactionCategorizationResult[]> => {
			if (routesUnavailable) throw new BankTransactionCategorizationUnavailableError();
			if (shouldFail) {
				throw new BankTransactionCategorizationProviderError('synthetic provider failure', false);
			}
			if (retryableFailure) {
				throw new BankTransactionCategorizationProviderError(
					'Claude categorization request failed (503).',
					true,
				);
			}
			return transactions.map(({correlationId}) => ({
				correlationId,
				category: correlationId === CATEGORIZATION_E2E_WEB_TRANSACTION_ID ? 'OTHER' : AI_CATEGORY,
				confidence: correlationId === CATEGORIZATION_E2E_WEB_TRANSACTION_ID ? 0.25 : AI_CONFIDENCE,
				provider: 'claude-api',
				model: 'test-model',
			}));
		},
	);

const categorizeWithWebSearchSpy = jest
	.spyOn(ClaudeBankTransactionCategorizationProvider.prototype, 'categorizeWithWebSearch')
	.mockImplementation(
		async (
			transactions: readonly BankTransactionCategorizationWebSearchInput[],
		): Promise<readonly BankTransactionCategorizationResult[]> => {
			if (searchUnavailable) throw new BankTransactionCategorizationUnavailableError();
			return transactions.map(({correlationId}) => ({
				correlationId,
				category: WEB_CATEGORY,
				confidence: WEB_CONFIDENCE,
				provider: 'claude-api',
				model: 'test-model',
			}));
		},
	);

async function waitFor<T>(read: () => Promise<T>, predicate: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	let value = await read();
	while (!predicate(value) && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 100));
		value = await read();
	}
	if (!predicate(value))
		throw new Error(`Timed out after ${timeoutMs}ms waiting for the expected response: ${JSON.stringify(value)}`);
	return value;
}

describe('Bank transaction categorization integration', () => {
	jest.setTimeout(30_000);

	let app: INestApplication<Server>;
	let httpServer: Server;
	let verifiedAgent: TestAgent;
	let bankTransactionRepository: Repository<BankTransaction>;

	beforeAll(async () => {
		app = getApp();
		await seedBankTransactionCategorizationData(app);
		httpServer = app.getHttpServer();

		const configurationService = app.get(ConfigurationService);
		expect(configurationService.get('AI_CATEGORIZATION_ENABLED')).toBe(true);
		expect(configurationService.get('AI_CATEGORIZATION_PROVIDER')).toBe(
			BANK_TRANSACTION_CATEGORIZATION_PROVIDER_NAME,
		);
		expect(configurationService.get('AI_CATEGORIZATION_WEB_SEARCH_ENABLED')).toBe(true);
		expect(configurationService.get('ANTHROPIC_API_KEY')).toBeTruthy();

		bankTransactionRepository = app.get<Repository<BankTransaction>>(getRepositoryToken(BankTransaction));
		verifiedAgent = await loginAgent(httpServer, VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);
	});

	beforeEach(() => {
		shouldFail = false;
		routesUnavailable = false;
		searchUnavailable = false;
		retryableFailure = false;
		categorizeSpy.mockClear();
		categorizeWithWebSearchSpy.mockClear();
	});

	afterAll(() => {
		shouldFail = false;
		categorizeWithWebSearchSpy.mockRestore();
		categorizeSpy.mockRestore();
	});

	it('runs the real HTTP, database, queue, worker, and persistence path with a mocked provider response', async () => {
		const categorizationService = app.get(BankTransactionCategorizationService);
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
		const categorizationService = app.get(BankTransactionCategorizationService);
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
		await app.get(BankTransactionCategorizationService).enqueueForTransactions(ids);
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
			.get(BankTransactionCategorizationService)
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
			.get(BankTransactionCategorizationService)
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
		const categorizationService = app.get(BankTransactionCategorizationService);
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

	it('keeps a row pending when its web search is unavailable on both routes, then completes it on retry', async () => {
		searchUnavailable = true;
		const categorizationService = app.get(BankTransactionCategorizationService);
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
			categorizationService.processTransactionJob([CATEGORIZATION_E2E_WEB_TRANSACTION_ID]),
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

	it('keeps a real worker outage pending and retries the job a minute later', async () => {
		routesUnavailable = true;
		const categorizationService = app.get(BankTransactionCategorizationService);
		const queue = app.get<Queue>(getQueueToken(BANK_TRANSACTION_CATEGORIZATION_QUEUE));
		await bankTransactionRepository.update(CATEGORIZATION_E2E_FAILURE_TRANSACTION_ID, {
			category: null,
			categoryStatus: 'PENDING',
			categorySource: null,
			categoryConfidence: null,
			categoryInputHash: null,
			categoryAppliedInputHash: null,
			categoryProvider: null,
			categoryModel: null,
			categoryPromptVersion: null,
			categorySearchTrace: null,
			categoryUpdatedAt: null,
			categoryLastError: null,
		});
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

			routesUnavailable = false;
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
			routesUnavailable = false;
			// The sweep's own batches for other pending rows would otherwise run during later tests.
			const leftover = await queue.getJobs(['delayed']);
			await Promise.all(
				leftover.filter((job) => job.name === CATEGORIZE_BANK_TRANSACTIONS_JOB).map((job) => job.remove()),
			);
		}
	});

	it('retries an ordinary model failure within seconds, then leaves the row failed', async () => {
		retryableFailure = true;
		const queue = app.get<Queue>(getQueueToken(BANK_TRANSACTION_CATEGORIZATION_QUEUE));
		try {
			await bankTransactionRepository.update(CATEGORIZATION_E2E_FAILURE_TRANSACTION_ID, {
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
			});
			await app
				.get(BankTransactionCategorizationService)
				.enqueueForTransactions([CATEGORIZATION_E2E_FAILURE_TRANSACTION_ID]);

			await waitFor(
				async () => categorizeSpy.mock.calls.length,
				(calls) => calls === 3,
			);
			await waitFor(
				async () => (await queue.getJobs(['delayed', 'waiting', 'active'])).length,
				(count) => count === 0,
			);
			expect(categorizeSpy).toHaveBeenCalledTimes(3);
			const persisted = await bankTransactionRepository.findOneByOrFail({
				id: CATEGORIZATION_E2E_FAILURE_TRANSACTION_ID,
			});
			expect(persisted).toMatchObject({
				category: null,
				categoryStatus: 'FAILED',
				categoryLastError: 'Claude categorization request failed (503).',
			});
		} finally {
			retryableFailure = false;
		}
	});

	it('persists a provider failure through the real worker path without calling an external provider', async () => {
		shouldFail = true;
		try {
			await bankTransactionRepository.update(CATEGORIZATION_E2E_FAILURE_TRANSACTION_ID, {
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
			});
			const categorizationService = app.get(BankTransactionCategorizationService);
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
