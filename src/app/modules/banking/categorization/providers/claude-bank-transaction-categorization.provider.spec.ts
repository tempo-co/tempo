import {readFileSync} from 'node:fs';
import {mkdtemp, rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {ConfigurationService} from '@core/config/config.service';

import {
	toBankTransactionCategorizationInput,
	toBankTransactionCategorizationWebSearchInput,
} from '../bank-transaction-categorization-input';
import {BankTransactionCategorizationUnavailableError} from '../bank-transaction-categorization.provider';
import type {BankTransactionCategorizationInput} from '../bank-transaction-categorization.types';
import {BANK_TRANSACTION_CATEGORIES, BANK_TRANSACTION_CATEGORY_DEFINITIONS} from '../bank-transaction-category';
import {ClaudeBankTransactionCategorizationProvider} from './claude-bank-transaction-categorization.provider';

function input(correlationId = 'transaction-1'): BankTransactionCategorizationInput {
	return {
		correlationId,
		transactionDate: '2026-09-01',
		bookingDate: null,
		valueDate: null,
		amount: '-10.00',
		currency: 'EUR',
		creditDebitIndicator: 'DBIT',
		direction: 'EXPENSE',
		transactionType: 'CARD_PAYMENT',
		bankTransactionCode: null,
		bankTransactionSubCode: null,
		description: 'Example Cafe',
		counterpartyName: 'Example Cafe',
		bankTransactionDescription: null,
		merchantCategoryCode: '5814',
		remittanceInformation: null,
	};
}

function setup(overrides: Record<string, unknown> = {}) {
	const create = jest.fn();
	const config = {
		get: (key: string) =>
			({
				ANTHROPIC_API_KEY: 'synthetic-api-key',
				AI_CATEGORIZATION_MODEL: 'claude-opus-5-5',
				...overrides,
			})[key],
	} as unknown as ConfigurationService;
	return {provider: new ClaudeBankTransactionCategorizationProvider(config, {messages: {create}} as never), create};
}

function response(classifications: unknown[]) {
	return {
		stop_reason: 'end_turn',
		content: [{type: 'text', text: JSON.stringify({classifications})}],
		usage: {server_tool_use: {web_search_requests: 0}},
	};
}

describe('ClaudeBankTransactionCategorizationProvider', () => {
	it('uses the evaluated structured API request and maps compact IDs back to the caller', async () => {
		const {provider, create} = setup();
		create.mockResolvedValue(response([{correlationId: '0', category: 'FOOD_AND_DRINK', confidence: 0.9}]));
		await expect(provider.categorize([input()], BANK_TRANSACTION_CATEGORY_DEFINITIONS)).resolves.toEqual([
			{
				correlationId: 'transaction-1',
				category: 'FOOD_AND_DRINK',
				confidence: 0.9,
				provider: 'claude-api',
				model: 'claude-opus-5-5',
			},
		]);
		expect(create).toHaveBeenCalledTimes(1);
		const request = create.mock.calls[0][0];
		expect(request).toMatchObject({
			model: 'claude-opus-5-5',
			max_tokens: 8192,
			thinking: {type: 'adaptive'},
			output_config: {effort: 'medium', format: {type: 'json_schema'}},
		});
		expect(request.output_config.format.schema.properties.classifications.items.properties.category.enum).toEqual(
			BANK_TRANSACTION_CATEGORIES,
		);
		expect(JSON.parse(request.messages[0].content)).toEqual({
			categories: BANK_TRANSACTION_CATEGORY_DEFINITIONS,
			transactions: [{...input(), correlationId: '0'}],
		});
		expect(request.system).toContain('Use OTHER only when the available evidence supports');
		expect(request).not.toHaveProperty('tools');
		expect(request).not.toHaveProperty('cache_control');
	});

	it('sends the same instructions and schema as the subscription bridge contract', async () => {
		const contract = JSON.parse(readFileSync(join(process.cwd(), 'ops/claude-bridge/contract.json'), 'utf8'));
		const {provider, create} = setup();
		create.mockResolvedValue(response([{correlationId: '0', category: 'FOOD_AND_DRINK', confidence: 0.9}]));
		await provider.categorize([input()], BANK_TRANSACTION_CATEGORY_DEFINITIONS);
		const request = create.mock.calls[0][0];
		expect(request.system).toBe(contract.instructions);
		expect(request.output_config.format.schema).toEqual(contract.schema);
	});

	describe('structured response validation', () => {
		it.each([
			['unknown category', [{correlationId: '0', category: 'UNKNOWN', confidence: 0.5}]],
			['invalid confidence', [{correlationId: '0', category: 'SHOPPING', confidence: 2}]],
			[
				'duplicate ID',
				[
					{correlationId: '0', category: 'SHOPPING', confidence: 0.5},
					{correlationId: '0', category: 'SHOPPING', confidence: 0.5},
				],
			],
			['missing ID', []],
			['unknown ID', [{correlationId: '1', category: 'SHOPPING', confidence: 0.5}]],
			['extra field', [{correlationId: '0', category: 'SHOPPING', confidence: 0.5, reason: 'unexpected'}]],
		])('rejects %s without inventing a category', async (_name, classifications) => {
			const {provider, create} = setup();
			create.mockResolvedValue(response(classifications));
			await expect(provider.categorize([input()], BANK_TRANSACTION_CATEGORY_DEFINITIONS)).rejects.toBeInstanceOf(
				BankTransactionCategorizationUnavailableError,
			);
		});
		it.each(['max_tokens', 'pause_turn', 'refusal'])('rejects an incomplete %s response', async (stopReason) => {
			const {provider, create} = setup();
			create.mockResolvedValue({
				...response([{correlationId: '0', category: 'SHOPPING', confidence: 0.9}]),
				stop_reason: stopReason,
			});
			await expect(provider.categorize([input()], BANK_TRANSACTION_CATEGORY_DEFINITIONS)).rejects.toBeInstanceOf(
				BankTransactionCategorizationUnavailableError,
			);
		});
		it('does not dispatch invalid or oversized input batches', async () => {
			const {provider, create} = setup();
			await expect(
				provider.categorize([input(), input()], BANK_TRANSACTION_CATEGORY_DEFINITIONS),
			).rejects.toThrow();
			await expect(
				provider.categorize(
					Array.from({length: 51}, (_, n) => input(String(n))),
					BANK_TRANSACTION_CATEGORY_DEFINITIONS,
				),
			).rejects.toThrow();
			expect(create).not.toHaveBeenCalled();
		});
	});

	it('serializes only sanitized semantic fields on the API boundary', async () => {
		const {provider, create} = setup();
		create.mockResolvedValue(response([{correlationId: '0', category: 'SHOPPING', confidence: 0.9}]));
		const transaction = toBankTransactionCategorizationInput({
			...input(),
			id: 'private-id',
			description:
				'Example Shop IBAN: NL00 TEST 0000 0000 00 Ref: ABCD-123456 https://shop.example/private?token=sample-token seller@example.test',
			counterpartyName: 'Example Merchant Order: 7654321',
		});
		await provider.categorize([transaction], BANK_TRANSACTION_CATEGORY_DEFINITIONS);
		const sent = create.mock.calls[0][0].messages[0].content;
		expect(sent).toContain('Example Shop');
		expect(sent).not.toMatch(/NL00|ABCD|123456|7654321|private-id|sample-token|seller@example/);
	});

	it('searches once per sanitized candidate and extracts only final JSON and source hostnames', async () => {
		const {provider, create} = setup();
		const transaction = toBankTransactionCategorizationWebSearchInput(input())!;
		create.mockResolvedValue({
			stop_reason: 'end_turn',
			usage: {server_tool_use: {web_search_requests: 1}},
			content: [
				{type: 'text', text: 'I will look up this merchant.'},
				{type: 'server_tool_use', name: 'web_search', input: {query: transaction.searchQuery}},
				{
					type: 'web_search_tool_result',
					content: [{type: 'web_search_result', url: 'https://www.example.test/path?token=private'}],
				},
				{type: 'text', text: '{"classifications":['},
				{
					type: 'text',
					text: '{"correlationId":"0","category":"FOOD_AND_DRINK","confidence":0.8,"evidenceType":"MERCHANT_IDENTITY_ONLY"}]}',
				},
			],
		});
		await expect(
			provider.categorizeWithWebSearch([transaction], BANK_TRANSACTION_CATEGORY_DEFINITIONS),
		).resolves.toEqual([
			{
				correlationId: transaction.correlationId,
				category: 'FOOD_AND_DRINK',
				confidence: 0.8,
				provider: 'claude-api',
				model: 'claude-opus-5-5',
				searchTrace: {
					queries: [transaction.searchQuery],
					sourceDomains: ['example.test'],
					evidenceType: 'MERCHANT_IDENTITY_ONLY',
				},
			},
		]);
		const request = create.mock.calls[0][0];
		expect(request.tools).toEqual([{type: 'web_search_20250305', name: 'web_search', max_uses: 1}]);
		expect(request.max_tokens).toBe(4096);
		expect(request.system).toContain('Do not perform a follow-up lookup.');
		expect(request.messages[0].content).not.toContain('transaction-1');
		expect(create).toHaveBeenCalledTimes(1);
	});

	it('leaves failed searches for review without spending a subscription request', async () => {
		const {provider, create} = setup({AI_CATEGORIZATION_SUBSCRIPTION_SOCKET: '/missing-synthetic.sock'});
		create.mockRejectedValue({status: 400, message: 'secret raw input'});
		await expect(
			provider.categorizeWithWebSearch(
				[toBankTransactionCategorizationWebSearchInput(input())!],
				BANK_TRANSACTION_CATEGORY_DEFINITIONS,
			),
		).resolves.toEqual([
			expect.objectContaining({
				category: 'NEEDS_REVIEW',
				confidence: 0,
				searchTrace: {queries: [], sourceDomains: [], evidenceType: 'INSUFFICIENT'},
			}),
		]);
		expect(create).toHaveBeenCalledTimes(1);
	});

	it('falls back over a local socket, preserves history, and records the actual subscription route', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'claude-provider-'));
		const socket = join(directory, 'bridge.sock');
		const payloads: unknown[] = [];
		const server = createServer((req, res) => {
			const chunks: Buffer[] = [];
			req.on('data', (chunk: Buffer) => chunks.push(chunk));
			req.on('end', () => {
				payloads.push(JSON.parse(Buffer.concat(chunks).toString()));
				res.writeHead(200, {'content-type': 'application/json'});
				res.end(
					JSON.stringify({classifications: [{correlationId: '0', category: 'SHOPPING', confidence: 0.9}]}),
				);
			});
		});
		await new Promise<void>((resolve) => server.listen(socket, resolve));
		try {
			const {provider, create} = setup({AI_CATEGORIZATION_SUBSCRIPTION_SOCKET: socket});
			create.mockRejectedValue({status: 400, message: 'API credit balance exhausted, secret'});
			const transaction = {
				...input(),
				previousManualCategories: [
					{category: 'SHOPPING' as const, count: 2, recentExamples: [{amount: '-8.00', date: '2026-08-01'}]},
				],
			};
			await expect(provider.categorize([transaction], BANK_TRANSACTION_CATEGORY_DEFINITIONS)).resolves.toEqual([
				{
					correlationId: 'transaction-1',
					category: 'SHOPPING',
					confidence: 0.9,
					provider: 'claude-subscription',
					model: 'claude-opus-5-5',
				},
			]);
			expect(payloads).toEqual([
				{
					model: 'claude-opus-5-5',
					input: {
						categories: BANK_TRANSACTION_CATEGORY_DEFINITIONS,
						transactions: [{...transaction, correlationId: '0'}],
					},
				},
			]);
			expect(JSON.stringify(payloads)).not.toContain('synthetic-api-key');
		} finally {
			await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
			await rm(directory, {recursive: true, force: true});
		}
	});

	it('does not let SDK debug logging print upstream error bodies', async () => {
		const server = createServer((_req, res) => {
			res.writeHead(500, {'content-type': 'text/plain'});
			res.end('synthetic-leaked-transaction-text');
		});
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		const address = server.address() as {port: number};
		const previous = {log: process.env.ANTHROPIC_LOG, base: process.env.ANTHROPIC_BASE_URL};
		process.env.ANTHROPIC_LOG = 'debug';
		process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${address.port}`;
		const spies = (['debug', 'info', 'warn', 'error', 'log'] as const).map((method) =>
			jest.spyOn(console, method).mockImplementation(() => undefined),
		);
		try {
			const config = {
				get: (key: string) =>
					({ANTHROPIC_API_KEY: 'synthetic-api-key', AI_CATEGORIZATION_MODEL: 'claude-opus-5-5'})[key],
			} as unknown as ConfigurationService;
			const provider = new ClaudeBankTransactionCategorizationProvider(config);
			await expect(provider.categorize([input()], BANK_TRANSACTION_CATEGORY_DEFINITIONS)).rejects.toBeInstanceOf(
				BankTransactionCategorizationUnavailableError,
			);
			const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
			expect(logged).not.toContain('synthetic-leaked-transaction-text');
			expect(logged).not.toContain('synthetic-api-key');
		} finally {
			spies.forEach((spy) => spy.mockRestore());
			process.env.ANTHROPIC_LOG = previous.log;
			process.env.ANTHROPIC_BASE_URL = previous.base;
			if (previous.log === undefined) delete process.env.ANTHROPIC_LOG;
			if (previous.base === undefined) delete process.env.ANTHROPIC_BASE_URL;
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});

	it('returns a sanitized pending-retry error when API and subscription are unavailable', async () => {
		const {provider, create} = setup({AI_CATEGORIZATION_SUBSCRIPTION_SOCKET: '/missing-synthetic.sock'});
		create.mockRejectedValue({status: 500, message: 'synthetic-api-key raw transaction'});
		await expect(provider.categorize([input()], BANK_TRANSACTION_CATEGORY_DEFINITIONS)).rejects.toMatchObject({
			name: 'BankTransactionCategorizationUnavailableError',
			message: 'Claude categorization is temporarily unavailable.',
			retryable: true,
		});
	});
});
