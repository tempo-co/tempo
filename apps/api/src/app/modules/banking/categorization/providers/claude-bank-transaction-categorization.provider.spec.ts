import Anthropic from '@anthropic-ai/sdk';
import {Logger} from '@nestjs/common';
import {BANK_TRANSACTION_CATEGORIES, BANK_TRANSACTION_CATEGORY_DEFINITIONS} from '@tempo/contracts';
import {createHash} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {ConfigurationService} from '@core/config/config.service';

import contract from '../../../../../../claude-bridge/contract.json';
import merchantContract from '../../../../../../claude-bridge/merchant-contract.json';
import {toBankTransactionCategorizationInput} from '../bank-transaction-categorization-input';
import {toBridgeInputContract} from '../bank-transaction-categorization-input.schema';
import {
	BANK_TRANSACTION_CATEGORIZATION_MAX_SEARCH_TRACE_ITEMS,
	BANK_TRANSACTION_CATEGORIZATION_MAX_WEB_SEARCH_QUERY_LENGTH,
} from '../bank-transaction-categorization.constants';
import {
	BankTransactionCategorizationProviderError,
	BankTransactionCategorizationUnavailableError,
} from '../bank-transaction-categorization.provider';
import {
	BANK_TRANSACTION_CATEGORIZATION_SEARCH_EVIDENCE_TYPES,
	type BankTransactionCategorizationInput,
	MERCHANT_KINDS,
} from '../bank-transaction-categorization.types';
import {ClaudeBankTransactionCategorizationProvider} from './claude-bank-transaction-categorization.provider';

const SEARCH_QUERY = 'Example Cafe';

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

/** A call for one row, without a web search (`plain`) or allowed to search for the merchant (`search`). */
type CallKind = 'plain' | 'search';

function categorizeOn(provider: ClaudeBankTransactionCategorizationProvider, kind: CallKind) {
	return provider.categorize(
		[input()],
		BANK_TRANSACTION_CATEGORY_DEFINITIONS,
		kind === 'search' ? {searchQuery: SEARCH_QUERY} : {},
	);
}

/** How a call ended: a result, pending for a retry (the unavailable error), or failed (a retryable provider error). */
async function outcomeOf(
	provider: ClaudeBankTransactionCategorizationProvider,
	kind: CallKind,
): Promise<'categorized' | 'pending' | 'failed'> {
	try {
		await categorizeOn(provider, kind);
		return 'categorized';
	} catch (error) {
		if (error instanceof BankTransactionCategorizationUnavailableError) return 'pending';
		expect(error).toBeInstanceOf(BankTransactionCategorizationProviderError);
		expect(error).toMatchObject({retryable: true});
		return 'failed';
	}
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

function classification(overrides: Record<string, unknown> = {}) {
	return {correlationId: '0', category: 'FOOD_AND_DRINK', confidence: 0.9, evidenceType: 'MCC', ...overrides};
}

function response(classifications: unknown[]) {
	return {
		stop_reason: 'end_turn',
		content: [{type: 'text', text: JSON.stringify({classifications})}],
		usage: {server_tool_use: {web_search_requests: 0}},
	};
}

/** An API reply that ran one web search with `query`. */
function searchedResponse(query: unknown, overrides: object = {}) {
	return {
		stop_reason: 'end_turn',
		usage: {server_tool_use: {web_search_requests: 1}},
		content: [
			{type: 'text', text: 'I will look up this merchant.'},
			{type: 'server_tool_use', name: 'web_search', input: {query}},
			{
				type: 'web_search_tool_result',
				content: [{type: 'web_search_result', url: 'https://www.example.test/path?token=private'}],
			},
			{type: 'text', text: '{"classifications":['},
			{type: 'text', text: `${JSON.stringify(classification({evidenceType: 'MERCHANT_IDENTITY_ONLY'}))}]}`},
		],
		...overrides,
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
		create.mockResolvedValue(response([classification()]));
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
			max_tokens: 16_384,
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
		expect(request.system).toContain('Use OTHER only for a known kind of transaction');
		expect(request).not.toHaveProperty('tools');
		expect(request).not.toHaveProperty('cache_control');
	});

	it('keeps the shared contract limits equal to the app limits', () => {
		expect(contract.search.maxQueryLength).toBe(BANK_TRANSACTION_CATEGORIZATION_MAX_WEB_SEARCH_QUERY_LENGTH);
		expect(contract.search.maxSourceDomains).toBe(BANK_TRANSACTION_CATEGORIZATION_MAX_SEARCH_TRACE_ITEMS);
	});

	it('keeps the request schemas the bridge validates equal to the app input schema', () => {
		// Regenerate with `npm run contract:input`; the bridge must be reinstalled after the API deploys.
		expect(contract.input).toEqual(toBridgeInputContract().input);
	});

	it('keeps the shared contract enums equal to the app categories and evidence types', () => {
		const item = contract.schema.properties.classifications.items.properties;
		expect(item.category.enum).toEqual(BANK_TRANSACTION_CATEGORIES);
		expect(item.evidenceType.enum).toEqual(BANK_TRANSACTION_CATEGORIZATION_SEARCH_EVIDENCE_TYPES);
		expect(merchantContract.schema.properties.merchants.items.properties.kind.enum).toEqual(MERCHANT_KINDS);
	});

	it('sends the shared contract prompt and schema, offering one web search only with a query', async () => {
		const {provider, create} = setup();
		create.mockResolvedValue(response([classification()]));
		await categorizeOn(provider, 'plain');
		await categorizeOn(provider, 'search');
		const [plain, search] = create.mock.calls.map(([request]) => request);
		for (const request of [plain, search])
			expect([request.system, request.output_config.format.schema]).toEqual([
				contract.instructions,
				contract.schema,
			]);
		expect(plain).not.toHaveProperty('tools');
		expect(JSON.parse(plain.messages[0].content)).not.toHaveProperty('searchQuery');
		expect(search.tools).toEqual([{type: 'web_search_20250305', name: 'web_search', max_uses: 1}]);
		expect(JSON.parse(search.messages[0].content)).toMatchObject({searchQuery: SEARCH_QUERY});
		expect(search.messages[0].content).not.toContain('transaction-1');
	});

	describe('structured response validation', () => {
		it.each([
			['unknown category', [classification({category: 'UNKNOWN'})]],
			['invalid confidence', [classification({confidence: 2})]],
			['unknown evidence type', [classification({evidenceType: 'GUESS'})]],
			['duplicate ID', [classification(), classification()]],
			['missing ID', []],
			['unknown ID', [classification({correlationId: '1'})]],
			['extra field', [classification({reason: 'unexpected'})]],
		])('fails %s without inventing a category', async (_name, classifications) => {
			const {provider, create} = setup();
			create.mockResolvedValue(response(classifications));
			await expect(outcomeOf(provider, 'plain')).resolves.toBe('failed');
		});
		it.each(['max_tokens', 'pause_turn', 'refusal'])('fails an incomplete %s response', async (stopReason) => {
			const {provider, create} = setup();
			create.mockResolvedValue({...response([classification()]), stop_reason: stopReason});
			await expect(outcomeOf(provider, 'plain')).resolves.toBe('failed');
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
		create.mockResolvedValue(response([classification({category: 'SHOPPING'})]));
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

	it('records the query an API search ran and only its source hostnames, keeping the final JSON', async () => {
		const {provider, create} = setup();
		create.mockResolvedValue(searchedResponse(SEARCH_QUERY));
		await expect(categorizeOn(provider, 'search')).resolves.toEqual([
			{
				correlationId: 'transaction-1',
				category: 'FOOD_AND_DRINK',
				confidence: 0.9,
				provider: 'claude-api',
				model: 'claude-sonnet-5-5',
				searchTrace: {
					queries: [SEARCH_QUERY],
					sourceDomains: ['example.test'],
					evidenceType: 'MERCHANT_IDENTITY_ONLY',
				},
			},
		]);
		expect(create).toHaveBeenCalledTimes(1);
	});

	it('keeps the result of an API search that used another query, recording the query that ran', async () => {
		// The API cannot enforce the query before it runs; the paid answer is kept and the trace tells the truth.
		const {provider, create} = setup();
		create.mockResolvedValue(searchedResponse('Example Cafe menu'));
		const [result] = await categorizeOn(provider, 'search');
		expect(result.searchTrace?.queries).toEqual(['Example Cafe menu']);
	});

	it('stores no search trace when the model skipped the search it was offered', async () => {
		const {provider, create} = setup();
		create.mockResolvedValue(response([classification()]));
		const [result] = await categorizeOn(provider, 'search');
		expect(result).not.toHaveProperty('searchTrace');
	});

	describe('failure classification', () => {
		it.each([
			['the API is rate limited', 429, 'pending'],
			['the API is overloaded', 529, 'pending'],
			['the API refuses the key', 401, 'pending'],
			['the API refuses access', 403, 'pending'],
			['the API always rejects the request', 400, 'failed'],
			['the API fails after accepting the request', 500, 'failed'],
		] as const)('without a bridge, ends a call where %s (%s) as %s', async (_case, status, expected) => {
			for (const kind of ['plain', 'search'] as const) {
				const {provider, create} = setup();
				create.mockRejectedValue({status, message: 'secret raw input'});
				await expect(outcomeOf(provider, kind)).resolves.toBe(expected);
				expect(create).toHaveBeenCalledTimes(1);
			}
		});

		it.each([
			['a control character', 'Example\u0007Cafe'],
			[
				'a query longer than a trace holds',
				'x'.repeat(BANK_TRANSACTION_CATEGORIZATION_MAX_WEB_SEARCH_QUERY_LENGTH + 1),
			],
			['a query that is not text', 42],
		])('fails an API search with %s in its query', async (_case, query) => {
			const {provider, create} = setup();
			create.mockResolvedValue(searchedResponse(query));
			await expect(outcomeOf(provider, 'search')).resolves.toBe('failed');
			expect(create).toHaveBeenCalledTimes(1);
		});

		it('fails a reply that does not validate', async () => {
			for (const reply of [
				response([{correlationId: '0', category: 'SHOPPING'}]),
				searchedResponse(SEARCH_QUERY, {
					content: [{type: 'text', text: JSON.stringify({classifications: [{correlationId: '0'}]})}],
				}),
			]) {
				const {provider, create} = setup();
				create.mockResolvedValue(reply);
				await expect(outcomeOf(provider, 'search')).resolves.toBe('failed');
			}
		});

		it.each([
			['ran and failed', 502, 'failed', {error: 'claude_failed'}],
			['rejected the request', 400, 'failed', {error: 'invalid_request'}],
			['refused before running', 503, 'pending', {error: 'claude_unavailable'}],
		] as const)('ends a call the bridge %s (%s) as %s', async (_case, status, expected, body) => {
			for (const kind of ['plain', 'search'] as const) {
				await withBridge({status, body}, async (socket, requests) => {
					const {provider, create} = setup({AI_CATEGORIZATION_SUBSCRIPTION_SOCKET: socket});
					create.mockRejectedValue({status: 429});
					await expect(outcomeOf(provider, kind)).resolves.toBe(expected);
					expect(requests).toHaveLength(1);
				});
			}
		});

		it.each([
			['ran and failed', {status: 500}, 'failed'],
			['refused it', {status: 400}, 'pending'],
			['never reached', new Anthropic.APIConnectionError({message: 'synthetic'}), 'pending'],
		] as const)(
			'ends a call the API %s as %s when the bridge then refuses before running',
			async (_case, apiError, expected) => {
				await withBridge(unavailable, async (socket, requests) => {
					const {provider, create} = setup({AI_CATEGORIZATION_SUBSCRIPTION_SOCKET: socket});
					create.mockRejectedValue(apiError);
					await expect(outcomeOf(provider, 'search')).resolves.toBe(expected);
					expect(requests).toHaveLength(1);
				});
			},
		);

		it('leaves a call pending when the configured bridge socket is missing', async () => {
			for (const kind of ['plain', 'search'] as const) {
				const {provider, create} = setup({AI_CATEGORIZATION_SUBSCRIPTION_SOCKET: '/missing-synthetic.sock'});
				create.mockRejectedValue({status: 400, message: 'secret raw input'});
				await expect(outcomeOf(provider, kind)).resolves.toBe('pending');
			}
		});

		it.each([
			['no search flag', {classifications: [classification()]}, 'plain'],
			[
				'a search it was not allowed',
				{classifications: [classification()], searched: true, sourceDomains: []},
				'plain',
			],
		] as const)('fails a bridge reply with %s', async (_case, body, kind) => {
			await withBridge({body}, async (socket) => {
				const {provider, create} = setup({AI_CATEGORIZATION_SUBSCRIPTION_SOCKET: socket});
				create.mockRejectedValue({status: 400});
				await expect(outcomeOf(provider, kind)).resolves.toBe('failed');
			});
		});
	});

	it('falls back over a local socket, preserves history hints, and records the actual subscription route', async () => {
		const reply = {classifications: [classification({category: 'SHOPPING'})], searched: false, sourceDomains: []};
		await withBridge({body: reply}, async (socket, requests) => {
			const {provider, create} = setup({AI_CATEGORIZATION_SUBSCRIPTION_SOCKET: socket});
			create.mockRejectedValue({status: 400, message: 'API credit balance exhausted, secret'});
			const transaction = {
				...input(),
				previousManualCategories: [
					{
						category: 'SHOPPING' as const,
						count: 2,
						recentExamples: [{amount: '-8.00', currency: 'EUR', date: '2026-08-01', text: 'Gift'}],
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
			expect(requests.map(({url, body}) => ({url, body}))).toEqual([
				{
					url: '/categorize',
					body: {
						model: 'claude-sonnet-5-5',
						effort: 'high',
						input: {
							categories: BANK_TRANSACTION_CATEGORY_DEFINITIONS,
							transactions: [{...transaction, correlationId: '0'}],
						},
					},
				},
			]);
			expect(JSON.stringify(requests)).not.toContain('synthetic-api-key');
		});
	});

	it('falls back to a pinned subscription search and keeps only valid source hostnames', async () => {
		const reply = {
			classifications: [classification({evidenceType: 'MERCHANT_IDENTITY_ONLY'})],
			searched: true,
			sourceDomains: ['www.example.test', 'not a domain', 'javascript:alert(1)'],
		};
		await withBridge({body: reply}, async (socket, requests) => {
			const {provider, create} = setup({AI_CATEGORIZATION_SUBSCRIPTION_SOCKET: socket});
			create.mockRejectedValue({status: 400, message: 'API credit balance exhausted, secret'});
			await expect(categorizeOn(provider, 'search')).resolves.toEqual([
				{
					correlationId: 'transaction-1',
					category: 'FOOD_AND_DRINK',
					confidence: 0.9,
					provider: 'claude-subscription',
					model: 'claude-sonnet-5-5',
					searchTrace: {
						queries: [SEARCH_QUERY],
						sourceDomains: ['example.test'],
						evidenceType: 'MERCHANT_IDENTITY_ONLY',
					},
				},
			]);
			expect(requests).toHaveLength(1);
			expect(requests[0].url).toBe('/categorize');
			expect(requests[0].body).toEqual({
				model: 'claude-sonnet-5-5',
				effort: 'high',
				input: JSON.parse(create.mock.calls[0][0].messages[0].content),
			});
		});
	});

	it.each(['plain', 'search'] as const)('sends the contract fingerprint on %s fallback requests', async (kind) => {
		await withBridge(unavailable, async (socket, requests) => {
			const {provider, create} = setup({AI_CATEGORIZATION_SUBSCRIPTION_SOCKET: socket});
			create.mockRejectedValue({status: 400});
			await expect(categorizeOn(provider, kind)).rejects.toThrow(BankTransactionCategorizationUnavailableError);
			expect(requests).toHaveLength(1);
			expect(requests[0].hash).toBe(createHash('sha256').update(JSON.stringify(contract)).digest('hex'));
		});
	});

	it.each(['plain', 'search'] as const)('logs a safe actionable warning on a %s contract mismatch', async (kind) => {
		const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
		try {
			await withBridge({status: 409, body: {error: 'synthetic-private-text'}}, async (socket) => {
				const {provider, create} = setup({AI_CATEGORIZATION_SUBSCRIPTION_SOCKET: socket});
				create.mockRejectedValue({status: 400});
				await expect(categorizeOn(provider, kind)).rejects.toThrow(
					BankTransactionCategorizationUnavailableError,
				);
			});
			expect(warn).toHaveBeenCalledWith('Claude bridge contract mismatch; reinstall and restart the bridge.');
			expect(JSON.stringify(warn.mock.calls)).not.toContain('synthetic-private-text');
		} finally {
			warn.mockRestore();
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
					({
						ANTHROPIC_API_KEY: 'synthetic-api-key',
						AI_CATEGORIZATION_MODEL: 'claude-sonnet-5-5',
						AI_CATEGORIZATION_EFFORT: 'high',
					})[key],
			} as unknown as ConfigurationService;
			const provider = new ClaudeBankTransactionCategorizationProvider(config);
			await expect(outcomeOf(provider, 'plain')).resolves.toBe('failed');
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
		create.mockRejectedValue({status: 429, message: 'synthetic-api-key raw transaction'});
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
