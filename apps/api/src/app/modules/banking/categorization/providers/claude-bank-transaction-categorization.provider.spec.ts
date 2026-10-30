import {Logger} from '@nestjs/common';
import {createHash} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {ConfigurationService} from '@core/config/config.service';

import contract from '../../../../../../ops/claude-bridge/contract.json';
import merchantContract from '../../../../../../ops/claude-bridge/merchant-contract.json';
import {
	toBankTransactionCategorizationInput,
	toBankTransactionCategorizationWebSearchInput,
} from '../bank-transaction-categorization-input';
import {
	BANK_TRANSACTION_CATEGORIZATION_MAX_SEARCH_TRACE_ITEMS,
	BANK_TRANSACTION_CATEGORIZATION_MAX_WEB_SEARCH_QUERY_LENGTH,
} from '../bank-transaction-categorization.constants';
import {BankTransactionCategorizationUnavailableError} from '../bank-transaction-categorization.provider';
import {
	BANK_TRANSACTION_CATEGORIZATION_SEARCH_EVIDENCE_TYPES,
	type BankTransactionCategorizationInput,
	MERCHANT_KINDS,
} from '../bank-transaction-categorization.types';
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

function searchOn(provider: ClaudeBankTransactionCategorizationProvider) {
	return provider.categorizeWithWebSearch(
		[toBankTransactionCategorizationWebSearchInput(input())!],
		BANK_TRANSACTION_CATEGORY_DEFINITIONS,
	);
}

function categorizeOn(provider: ClaudeBankTransactionCategorizationProvider, route: 'standard' | 'search') {
	return route === 'standard'
		? provider.categorize([input()], BANK_TRANSACTION_CATEGORY_DEFINITIONS)
		: searchOn(provider);
}

function setup(overrides: Record<string, unknown> = {}) {
	const create = jest.fn();
	const config = {
		get: (key: string) =>
			({
				ANTHROPIC_API_KEY: 'synthetic-api-key',
				AI_CATEGORIZATION_MODEL: 'claude-sonnet-5-5',
				AI_CATEGORIZATION_EFFORT: 'high',
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

type BridgeRequest = {url?: string; body: unknown; hash?: string};
const unavailable = {status: 503, body: {error: 'claude_unavailable'}};

/** A fake subscription bridge on a Unix socket that records requests and returns one fixed reply. */
async function withBridge(
	reply: {status?: number; body: object},
	run: (socket: string, requests: BridgeRequest[]) => Promise<void>,
): Promise<void> {
	const {status = 200, body} = reply;
	const directory = await mkdtemp(join(tmpdir(), 'claude-provider-'));
	const socket = join(directory, 'bridge.sock');
	const requests: BridgeRequest[] = [];
	const server = createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on('data', (chunk: Buffer) => chunks.push(chunk));
		req.on('end', () => {
			requests.push({
				url: req.url,
				body: JSON.parse(Buffer.concat(chunks).toString()),
				hash: req.headers['x-tempo-contract'] as string | undefined,
			});
			res.writeHead(status, {'content-type': 'application/json'});
			res.end(JSON.stringify(body));
		});
	});
	await new Promise<void>((resolve) => server.listen(socket, resolve));
	try {
		await run(socket, requests);
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await rm(directory, {recursive: true, force: true});
	}
}

describe('ClaudeBankTransactionCategorizationProvider', () => {
	it.each([
		['claude-sonnet-5-5', 'high'],
		['claude-opus-5-5', 'medium'],
	])('uses the configured %s model at %s effort and maps compact IDs back to the caller', async (model, effort) => {
		const {provider, create} = setup({AI_CATEGORIZATION_MODEL: model, AI_CATEGORIZATION_EFFORT: effort});
		create.mockResolvedValue(response([{correlationId: '0', category: 'FOOD_AND_DRINK', confidence: 0.9}]));
		await expect(provider.categorize([input()], BANK_TRANSACTION_CATEGORY_DEFINITIONS)).resolves.toEqual([
			{
				correlationId: 'transaction-1',
				category: 'FOOD_AND_DRINK',
				confidence: 0.9,
				provider: 'claude-api',
				model,
			},
		]);
		expect(create).toHaveBeenCalledTimes(1);
		const request = create.mock.calls[0][0];
		expect(request).toMatchObject({
			model,
			max_tokens: 8192,
			thinking: {type: 'adaptive'},
			output_config: {effort, format: {type: 'json_schema'}},
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

	it('keeps the shared contract limits equal to the app limits', () => {
		expect(contract.webSearch.maxSearchQueryLength).toBe(
			BANK_TRANSACTION_CATEGORIZATION_MAX_WEB_SEARCH_QUERY_LENGTH,
		);
		expect(contract.webSearch.maxSourceDomains).toBe(BANK_TRANSACTION_CATEGORIZATION_MAX_SEARCH_TRACE_ITEMS);
	});

	it('keeps the shared contract enums equal to the app categories and evidence types', () => {
		const item = (schema: typeof contract.schema) => schema.properties.classifications.items.properties;
		expect(item(contract.schema).category.enum).toEqual(BANK_TRANSACTION_CATEGORIES);
		expect(item(contract.webSearch.schema).category.enum).toEqual(BANK_TRANSACTION_CATEGORIES);
		expect(contract.webSearch.schema.properties.classifications.items.properties.evidenceType.enum).toEqual(
			BANK_TRANSACTION_CATEGORIZATION_SEARCH_EVIDENCE_TYPES,
		);
		expect(merchantContract.schema.properties.merchants.items.properties.kind.enum).toEqual(MERCHANT_KINDS);
	});

	it('sends the shared contract prompts and schemas on both API requests', async () => {
		const {provider, create} = setup();
		create.mockResolvedValue(response([{correlationId: '0', category: 'FOOD_AND_DRINK', confidence: 0.9}]));
		await provider.categorize([input()], BANK_TRANSACTION_CATEGORY_DEFINITIONS);
		create.mockRejectedValue(new Error('synthetic'));
		await provider.categorizeWithWebSearch(
			[toBankTransactionCategorizationWebSearchInput(input())!],
			BANK_TRANSACTION_CATEGORY_DEFINITIONS,
		);
		const [standard, search] = create.mock.calls.map(([request]) => request);
		expect([standard.system, standard.output_config.format.schema]).toEqual([
			contract.instructions,
			contract.schema,
		]);
		expect([search.system, search.output_config.format.schema]).toEqual([
			contract.webSearch.instructions,
			contract.webSearch.schema,
		]);
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
				model: 'claude-sonnet-5-5',
				searchTrace: {
					queries: [transaction.searchQuery],
					sourceDomains: ['example.test'],
					evidenceType: 'MERCHANT_IDENTITY_ONLY',
				},
			},
		]);
		const request = create.mock.calls[0][0];
		expect(request).toMatchObject({model: 'claude-sonnet-5-5', output_config: {effort: 'high'}});
		expect(request.tools).toEqual([{type: 'web_search_20250305', name: 'web_search', max_uses: 1}]);
		expect(request.max_tokens).toBe(4096);
		expect(request.system).toContain('Do not perform a follow-up lookup.');
		expect(request.messages[0].content).not.toContain('transaction-1');
		expect(create).toHaveBeenCalledTimes(1);
	});

	it.each([
		['the subscription socket is missing', 400, {AI_CATEGORIZATION_SUBSCRIPTION_SOCKET: '/missing-synthetic.sock'}],
		['no subscription is configured and the API is rate limited', 429, {}],
		['no subscription is configured and the API is overloaded', 529, {}],
	])('leaves a search pending for retry when %s', async (_case, status, config) => {
		const {provider, create} = setup(config);
		create.mockRejectedValue({status, message: 'secret raw input'});
		await expect(searchOn(provider)).rejects.toThrow(BankTransactionCategorizationUnavailableError);
		expect(create).toHaveBeenCalledTimes(1);
	});

	it('sends a search the API always rejects to review when no subscription is configured', async () => {
		const {provider, create} = setup();
		create.mockRejectedValue({status: 400, message: 'secret raw input'});
		await expect(searchOn(provider)).resolves.toEqual([
			expect.objectContaining({category: 'NEEDS_REVIEW', confidence: 0, provider: 'claude-api'}),
		]);
	});

	it.each([
		[502, {error: 'claude_failed'}],
		[400, {error: 'invalid_request'}],
	])('sends a search to review when the bridge ran or rejected it (%s)', async (status, body) => {
		await withBridge({status, body}, async (socket, requests) => {
			const {provider, create} = setup({AI_CATEGORIZATION_SUBSCRIPTION_SOCKET: socket});
			create.mockRejectedValue({status: 400});
			await expect(searchOn(provider)).resolves.toEqual([
				expect.objectContaining({category: 'NEEDS_REVIEW', confidence: 0, provider: 'claude-subscription'}),
			]);
			expect(requests).toHaveLength(1);
		});
	});

	it('falls back over a local socket, preserves history hints, and records the actual subscription route', async () => {
		const reply = {classifications: [{correlationId: '0', category: 'SHOPPING', confidence: 0.9}]};
		await withBridge({body: reply}, async (socket, requests) => {
			const {provider, create} = setup({AI_CATEGORIZATION_SUBSCRIPTION_SOCKET: socket});
			create.mockRejectedValue({status: 400, message: 'API credit balance exhausted, secret'});
			const transaction = {
				...input(),
				previousManualCategories: [
					{
						category: 'SHOPPING' as const,
						count: 2,
						recentExamples: [{amount: '-8.00', currency: 'EUR', date: '2026-08-01'}],
					},
				],
				sameAmountPayments: [
					{date: '2026-07-01', category: 'SHOPPING' as const, source: 'MANUAL' as const, text: null},
					{date: '2026-06-01', category: 'SHOPPING' as const, source: 'AI' as const, text: 'gift'},
				],
			};
			await expect(provider.categorize([transaction], BANK_TRANSACTION_CATEGORY_DEFINITIONS)).resolves.toEqual([
				{
					correlationId: 'transaction-1',
					category: 'SHOPPING',
					confidence: 0.9,
					provider: 'claude-subscription',
					model: 'claude-sonnet-5-5',
				},
			]);
			expect(requests.map(({body}) => body)).toEqual([
				{
					model: 'claude-sonnet-5-5',
					effort: 'high',
					input: {
						categories: BANK_TRANSACTION_CATEGORY_DEFINITIONS,
						transactions: [{...transaction, correlationId: '0'}],
					},
				},
			]);
			expect(JSON.stringify(requests)).not.toContain('synthetic-api-key');
		});
	});

	it('falls back to a pinned subscription search and keeps only valid source hostnames', async () => {
		const reply = {
			classifications: [
				{
					correlationId: '0',
					category: 'FOOD_AND_DRINK',
					confidence: 0.8,
					evidenceType: 'MERCHANT_IDENTITY_ONLY',
				},
			],
			sourceDomains: ['www.example.test', 'not a domain', 'javascript:alert(1)'],
		};
		await withBridge({body: reply}, async (socket, requests) => {
			const {provider, create} = setup({AI_CATEGORIZATION_SUBSCRIPTION_SOCKET: socket});
			create.mockRejectedValue({status: 400, message: 'API credit balance exhausted, secret'});
			const transaction = toBankTransactionCategorizationWebSearchInput(input())!;
			await expect(
				provider.categorizeWithWebSearch([transaction], BANK_TRANSACTION_CATEGORY_DEFINITIONS),
			).resolves.toEqual([
				{
					correlationId: transaction.correlationId,
					category: 'FOOD_AND_DRINK',
					confidence: 0.8,
					provider: 'claude-subscription',
					model: 'claude-sonnet-5-5',
					searchTrace: {
						queries: [transaction.searchQuery],
						sourceDomains: ['example.test'],
						evidenceType: 'MERCHANT_IDENTITY_ONLY',
					},
				},
			]);
			expect(requests).toHaveLength(1);
			expect(requests[0].url).toBe('/categorize-with-search');
			expect(requests[0].body).toEqual({
				model: 'claude-sonnet-5-5',
				effort: 'high',
				input: JSON.parse(create.mock.calls[0][0].messages[0].content),
			});
		});
	});

	describe('search budget across routes', () => {
		const searched = (query: string, overrides: object = {}) => ({
			stop_reason: 'end_turn',
			usage: {server_tool_use: {web_search_requests: 1}},
			content: [
				{type: 'server_tool_use', name: 'web_search', input: {query}},
				{type: 'web_search_tool_result', content: []},
				{
					type: 'text',
					text: '{"classifications":[{"correlationId":"0","category":"SHOPPING","confidence":0.8,"evidenceType":"MERCHANT_IDENTITY_ONLY"}]}',
				},
			],
			...overrides,
		});

		it.each([
			['a timeout', () => Promise.reject(new Error('synthetic timeout'))],
			['an HTTP 408', () => Promise.reject({status: 408})],
			[
				'a truncated reply after searching',
				(query: string) => Promise.resolve(searched(query, {stop_reason: 'max_tokens'})),
			],
		])('does not search again on the subscription after %s', async (_name, reply) => {
			await withBridge(unavailable, async (socket, requests) => {
				const {provider, create} = setup({AI_CATEGORIZATION_SUBSCRIPTION_SOCKET: socket});
				const transaction = toBankTransactionCategorizationWebSearchInput(input())!;
				create.mockImplementation(() => reply(transaction.searchQuery));
				const [result] = await provider.categorizeWithWebSearch(
					[transaction],
					BANK_TRANSACTION_CATEGORY_DEFINITIONS,
				);
				expect(result).toMatchObject({category: 'NEEDS_REVIEW', provider: 'claude-api'});
				expect(requests).toHaveLength(0);
			});
		});

		it('rejects an API result whose search used a different query', async () => {
			await withBridge(unavailable, async (socket, requests) => {
				const {provider, create} = setup({AI_CATEGORIZATION_SUBSCRIPTION_SOCKET: socket});
				create.mockResolvedValue(searched('Example Cafe -10.00 EUR'));
				await expect(
					provider.categorizeWithWebSearch(
						[toBankTransactionCategorizationWebSearchInput(input())!],
						BANK_TRANSACTION_CATEGORY_DEFINITIONS,
					),
				).rejects.toThrow('invalid categorization response');
				expect(requests).toHaveLength(0);
			});
		});

		it('leaves a subscription-only search pending for retry when the bridge is unavailable', async () => {
			await withBridge(unavailable, async (socket, requests) => {
				const config = {
					get: (key: string) =>
						({
							AI_CATEGORIZATION_MODEL: 'claude-sonnet-5-5',
							AI_CATEGORIZATION_EFFORT: 'high',
							AI_CATEGORIZATION_SUBSCRIPTION_SOCKET: socket,
						})[key],
				} as unknown as ConfigurationService;
				const provider = new ClaudeBankTransactionCategorizationProvider(config);
				await expect(
					provider.categorizeWithWebSearch(
						[toBankTransactionCategorizationWebSearchInput(input())!],
						BANK_TRANSACTION_CATEGORY_DEFINITIONS,
					),
				).rejects.toThrow(BankTransactionCategorizationUnavailableError);
				expect(requests).toHaveLength(1);
			});
		});
	});

	it.each(['standard', 'search'] as const)(
		'sends the contract fingerprint on %s fallback requests',
		async (route) => {
			await withBridge(unavailable, async (socket, requests) => {
				const {provider, create} = setup({AI_CATEGORIZATION_SUBSCRIPTION_SOCKET: socket});
				create.mockRejectedValue({status: 400});
				await expect(categorizeOn(provider, route)).rejects.toThrow(
					BankTransactionCategorizationUnavailableError,
				);
				expect(requests).toHaveLength(1);
				expect(requests[0].hash).toBe(createHash('sha256').update(JSON.stringify(contract)).digest('hex'));
			});
		},
	);

	it.each(['standard', 'search'] as const)(
		'logs a safe actionable warning on a %s contract mismatch',
		async (route) => {
			const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
			try {
				await withBridge({status: 409, body: {error: 'synthetic-private-text'}}, async (socket) => {
					const {provider, create} = setup({AI_CATEGORIZATION_SUBSCRIPTION_SOCKET: socket});
					create.mockRejectedValue({status: 400});
					await expect(categorizeOn(provider, route)).rejects.toThrow(
						BankTransactionCategorizationUnavailableError,
					);
				});
				expect(warn).toHaveBeenCalledWith('Claude bridge contract mismatch; reinstall and restart the bridge.');
				expect(JSON.stringify(warn.mock.calls)).not.toContain('synthetic-private-text');
			} finally {
				warn.mockRestore();
			}
		},
	);

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
					({
						ANTHROPIC_API_KEY: 'synthetic-api-key',
						AI_CATEGORIZATION_MODEL: 'claude-sonnet-5-5',
						AI_CATEGORIZATION_EFFORT: 'high',
					})[key],
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

	describe('merchant identification', () => {
		const merchant = (correlationId = 'merchant-1') => ({
			correlationId,
			name: 'Example Shop',
			location: 'Example City',
			transactionType: 'CARD_PAYMENT',
			direction: 'EXPENSE' as const,
			searchSourceDomains: ['shop.example.test'],
		});
		const merchantResponse = (merchants: unknown[]) => ({
			stop_reason: 'end_turn',
			content: [{type: 'text', text: JSON.stringify({merchants})}],
			usage: {server_tool_use: {web_search_requests: 0}},
		});

		it('sends only merchant names with the merchant contract and keeps a well-formed official domain', async () => {
			const {provider, create} = setup();
			create.mockResolvedValue(
				merchantResponse([
					{
						correlationId: '0',
						kind: 'BUSINESS',
						brand: ' Example  Shop ',
						domain: 'WWW.Shop.Example.test',
						domainConfident: true,
					},
					{
						correlationId: '1',
						kind: 'BUSINESS',
						brand: 'Example Cafe',
						domain: 'https://cafe.example.test/',
						domainConfident: true,
					},
					{
						correlationId: '2',
						kind: 'PERSON',
						brand: 'Example Person',
						domain: 'person.example.test',
						domainConfident: true,
					},
					{
						correlationId: '3',
						kind: 'PAYMENT_SERVICE',
						brand: 'Example Pay',
						domain: 'pay.example.test',
						domainConfident: false,
					},
				]),
			);
			await expect(
				provider.identifyMerchants([merchant('a'), merchant('b'), merchant('c'), merchant('d')]),
			).resolves.toEqual([
				{
					correlationId: 'a',
					kind: 'BUSINESS',
					brand: 'Example Shop',
					domain: 'shop.example.test',
					domainConfident: true,
				},
				{correlationId: 'b', kind: 'BUSINESS', brand: 'Example Cafe', domain: null, domainConfident: false},
				{correlationId: 'c', kind: 'PERSON', brand: null, domain: null, domainConfident: false},
				{
					correlationId: 'd',
					kind: 'PAYMENT_SERVICE',
					brand: 'Example Pay',
					domain: 'pay.example.test',
					domainConfident: false,
				},
			]);
			const request = create.mock.calls[0][0];
			expect(request.system).toBe(merchantContract.instructions);
			expect(request.output_config.format.schema).toEqual(merchantContract.schema);
			expect(request).not.toHaveProperty('tools');
			expect(JSON.parse(request.messages[0].content)).toEqual({
				merchants: ['0', '1', '2', '3'].map((correlationId) => ({...merchant(), correlationId})),
			});
		});

		it('falls back to the subscription bridge, and stays pending only when both routes refused', async () => {
			const reply = {
				merchants: [{correlationId: '0', kind: 'UNCLEAR', brand: null, domain: null, domainConfident: false}],
			};
			await withBridge({body: reply}, async (socket, requests) => {
				const {provider, create} = setup({AI_CATEGORIZATION_SUBSCRIPTION_SOCKET: socket});
				create.mockRejectedValue({status: 400});
				await expect(provider.identifyMerchants([merchant()])).resolves.toEqual([
					{correlationId: 'merchant-1', kind: 'UNCLEAR', brand: null, domain: null, domainConfident: false},
				]);
				expect(requests).toEqual([
					{
						url: '/identify-merchants',
						body: {
							model: 'claude-sonnet-5-5',
							effort: 'high',
							input: {merchants: [{...merchant(), correlationId: '0'}]},
						},
						hash: createHash('sha256').update(JSON.stringify(merchantContract)).digest('hex'),
					},
				]);
			});
			await withBridge(unavailable, async (socket) => {
				const {provider, create} = setup({AI_CATEGORIZATION_SUBSCRIPTION_SOCKET: socket});
				create.mockRejectedValue({status: 429});
				await expect(provider.identifyMerchants([merchant()])).rejects.toBeInstanceOf(
					BankTransactionCategorizationUnavailableError,
				);
				// The API model ran but answered for an unknown merchant: an attempt that counts, not an outage.
				create.mockResolvedValue(
					merchantResponse([
						{correlationId: '9', kind: 'UNCLEAR', brand: null, domain: null, domainConfident: false},
					]),
				);
				await expect(provider.identifyMerchants([merchant()])).rejects.toMatchObject({
					name: 'BankTransactionCategorizationProviderError',
				});
			});
		});
	});
});
