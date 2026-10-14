import {INestApplication} from '@nestjs/common';
import {getRepositoryToken} from '@nestjs/typeorm';
import {Server} from 'node:net';
import TestAgent from 'supertest/lib/agent';
import {Repository} from 'typeorm';

import {ConfigurationService} from '@core/config/config.service';
import {BankTransaction} from '@modules/banking/bank-transaction.entity';
import {
	BANK_TRANSACTION_CATEGORIZATION_MANUAL_HISTORY_PROMPT_VERSION,
	BANK_TRANSACTION_CATEGORIZATION_MANUAL_HISTORY_PROVIDER,
	BANK_TRANSACTION_CATEGORIZATION_PROVIDER_NAME,
	BANK_TRANSACTION_CATEGORIZATION_WEB_SEARCH_PROMPT_VERSION,
} from '@modules/banking/categorization/bank-transaction-categorization.constants';
import {BankTransactionCategorizationProviderError} from '@modules/banking/categorization/bank-transaction-categorization.provider';
import {BankTransactionCategorizationService} from '@modules/banking/categorization/bank-transaction-categorization.service';
import type {
	BankTransactionCategorizationInput,
	BankTransactionCategorizationResult,
	BankTransactionCategorizationWebSearchInput,
} from '@modules/banking/categorization/bank-transaction-categorization.types';
import {OpenAiBankTransactionCategorizationProvider} from '@modules/banking/categorization/providers/openai-bank-transaction-categorization.provider';

import {VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD} from '../../../scripts/seed-data/seed.constants';
import {
	CATEGORIZATION_E2E_AI_TRANSACTION_ID,
	CATEGORIZATION_E2E_FAILURE_TRANSACTION_ID,
	CATEGORIZATION_E2E_REPEAT_MERCHANT_TRANSACTION_ID,
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

const categorizeSpy = jest
	.spyOn(OpenAiBankTransactionCategorizationProvider.prototype, 'categorize')
	.mockImplementation(
		async (
			transactions: readonly BankTransactionCategorizationInput[],
		): Promise<readonly BankTransactionCategorizationResult[]> => {
			if (shouldFail) {
				throw new BankTransactionCategorizationProviderError('synthetic provider failure', false);
			}
			return transactions.map(({correlationId}) => ({
				correlationId,
				category: correlationId === CATEGORIZATION_E2E_WEB_TRANSACTION_ID ? 'OTHER' : AI_CATEGORY,
				confidence: correlationId === CATEGORIZATION_E2E_WEB_TRANSACTION_ID ? 0.25 : AI_CONFIDENCE,
			}));
		},
	);

const categorizeWithWebSearchSpy = jest
	.spyOn(OpenAiBankTransactionCategorizationProvider.prototype, 'categorizeWithWebSearch')
	.mockImplementation(
		async (
			transactions: readonly BankTransactionCategorizationWebSearchInput[],
		): Promise<readonly BankTransactionCategorizationResult[]> =>
			transactions.map(({correlationId}) => ({
				correlationId,
				category: WEB_CATEGORY,
				confidence: WEB_CONFIDENCE,
			})),
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
		expect(configurationService.get('OPENAI_API_KEY')).toBeTruthy();

		bankTransactionRepository = app.get<Repository<BankTransaction>>(getRepositoryToken(BankTransaction));
		verifiedAgent = await loginAgent(httpServer, VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);
	});

	beforeEach(() => {
		shouldFail = false;
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
			categoryProvider: BANK_TRANSACTION_CATEGORIZATION_PROVIDER_NAME,
		});
	});

	it("reuses the account owner's manual category for the same card merchant without calling the provider", async () => {
		const categorizationService = app.get(BankTransactionCategorizationService);
		await categorizationService.enqueueForTransactions([CATEGORIZATION_E2E_REPEAT_MERCHANT_TRANSACTION_ID]);

		const response = await waitFor(
			() => verifiedAgent.get(`/bank-transactions/${CATEGORIZATION_E2E_REPEAT_MERCHANT_TRANSACTION_ID}`),
			(value) => value.status === 200 && value.body.categoryStatus === 'COMPLETED',
		);

		expect(response.body).toMatchObject({category: 'TRANSPORTATION', categorySource: 'AI'});
		expect(categorizeSpy).not.toHaveBeenCalled();
		expect(categorizeWithWebSearchSpy).not.toHaveBeenCalled();
		const persisted = await bankTransactionRepository.findOneByOrFail({
			id: CATEGORIZATION_E2E_REPEAT_MERCHANT_TRANSACTION_ID,
		});
		expect(persisted).toMatchObject({
			categoryProvider: BANK_TRANSACTION_CATEGORIZATION_MANUAL_HISTORY_PROVIDER,
			categoryPromptVersion: BANK_TRANSACTION_CATEGORIZATION_MANUAL_HISTORY_PROMPT_VERSION,
			categoryModel: null,
		});
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
