import Anthropic from '@anthropic-ai/sdk';
import {Logger} from '@nestjs/common';
import {BANK_TRANSACTION_CATEGORIES, BANK_TRANSACTION_CATEGORY_DEFINITIONS} from '@tempo/contracts';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';

import {ConfigurationService} from '@core/config/config.service';

import {toBankTransactionCategorizationInput} from '../bank-transaction-categorization-input';
import {toInputContract} from '../bank-transaction-categorization-input.schema';
import {BANK_TRANSACTION_CATEGORIZATION_PROMPT_VERSION} from '../bank-transaction-categorization.constants';
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
import {type BraveWebSearchClient, BraveWebSearchError} from './brave-web-search.client';
import {ClaudeBankTransactionCategorizationProvider} from './claude-bank-transaction-categorization.provider';
import contract from './claude-categorization-contract.json';
import merchantContract from './claude-merchant-contract.json';

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

/** A call for one row, without a merchant search query (`plain`) or with one (`search`). */
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
	const search = jest.fn();
	const config = {
		get: (key: string) =>
			({
				ANTHROPIC_API_KEY: 'synthetic-api-key',
				AI_CATEGORIZATION_MODEL: 'claude-sonnet-5-5',
				AI_CATEGORIZATION_EFFORT: 'high',
				...overrides,
			})[key],
	} as unknown as ConfigurationService;
	const webSearch = {search} as unknown as BraveWebSearchClient;
	return {
		provider: new ClaudeBankTransactionCategorizationProvider(config, webSearch, {messages: {create}} as never),
		create,
		search,
	};
}

function classification(overrides: Record<string, unknown> = {}) {
	return {correlationId: '0', category: 'EATING_OUT', confidence: 0.9, evidenceType: 'MCC', ...overrides};
}

/** The categorizing call's reply: the answer as the input of its one StructuredOutput tool call. */
function response(classifications: unknown[], {lookUpMerchant = false} = {}) {
	return {
		stop_reason: 'tool_use',
		content: [{type: 'thinking', thinking: '', signature: ''}, structuredOutput({lookUpMerchant, classifications})],
		usage: {server_tool_use: {web_search_requests: 0}},
	};
}

function structuredOutput(input: unknown, name = 'StructuredOutput') {
	return {type: 'tool_use', id: 'toolu_synthetic', name, input};
}

/** The tool the categorizing request offers, and only it: no server tool, an auto choice, one call. */
const STRUCTURED_OUTPUT_REQUEST = {
	tools: [
		{name: 'StructuredOutput', description: expect.stringContaining('exactly once'), input_schema: contract.schema},
	],
	tool_choice: {type: 'auto', disable_parallel_tool_use: true},
};

/** Top web results as the search client returns them. */
const SEARCH_RESULTS = [
	{title: 'Example Cafe', hostname: 'cafe.example.test', snippet: 'A cafe serving coffee and pastries.'},
	{title: null, hostname: 'reviews.example.test', snippet: 'Reviews of Example Cafe.'},
	{title: 'Example Cafe menu', hostname: 'cafe.example.test', snippet: 'Coffee, tea and cake.'},
];

/** A categorizing reply that ran one web search with `query`, which a request without a server tool must never produce. */
function searchedResponse(query: string) {
	return {
		stop_reason: 'tool_use',
		usage: {server_tool_use: {web_search_requests: 1}},
		content: [
			{type: 'text', text: 'I will look up this merchant.'},
			{type: 'server_tool_use', name: 'web_search', input: {query}},
			{
				type: 'web_search_tool_result',
				content: [{type: 'web_search_result', url: 'https://www.example.test/path?token=private'}],
			},
			structuredOutput({
				lookUpMerchant: false,
				classifications: [classification({evidenceType: 'MERCHANT_IDENTITY_ONLY'})],
			}),
		],
	};
}

/** The error the SDK throws for an HTTP error reply, with the body Anthropic sends. */
function apiError(status: number, type: string, message: string) {
	return {status, type, message: `${status} ${message}`, error: {type: 'error', error: {type, message}}};
}

const CREDIT_BALANCE_TOO_LOW =
	'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.';

describe('ClaudeBankTransactionCategorizationProvider', () => {
	it.each([
		['claude-sonnet-5-5', 'high'],
		['claude-opus-5-5', 'medium'],
	])('uses the configured %s model at %s effort and maps compact IDs back to the caller', async (model, effort) => {
		const {provider, create} = setup({AI_CATEGORIZATION_MODEL: model, AI_CATEGORIZATION_EFFORT: effort});
		create.mockResolvedValue(response([classification()]));
		const transaction = {
			...input(),
			ownerBank: {name: 'Example Bank', country: 'NL'},
			counterpartyHistory: [
				{
					date: '2026-08-01',
					amount: '-10.00',
					currency: 'EUR',
					direction: 'EXPENSE' as const,
					category: 'EATING_OUT' as const,
				},
				{
					date: '2026-07-15',
					amount: '4.50',
					currency: 'EUR',
					direction: 'INCOME' as const,
					category: 'REFUND' as const,
				},
			],
		};
		await expect(provider.categorize([transaction], BANK_TRANSACTION_CATEGORY_DEFINITIONS)).resolves.toEqual([
			{
				correlationId: 'transaction-1',
				category: 'EATING_OUT',
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
			...STRUCTURED_OUTPUT_REQUEST,
		});
		// The answer comes back through the tool, not a strict json_schema format.
		expect(request.output_config).toEqual({effort});
		expect(request.tools[0].input_schema.properties.classifications.items.properties.category.enum).toEqual(
			BANK_TRANSACTION_CATEGORIES,
		);
		// Tools, instructions and categories form the cached prefix; the breakpoint sits on its last system block.
		expect(request.system).toEqual([
			{type: 'text', text: contract.instructions},
			{type: 'text', text: expect.any(String), cache_control: {type: 'ephemeral'}},
		]);
		expect(JSON.parse(request.system[1].text)).toEqual({categories: BANK_TRANSACTION_CATEGORY_DEFINITIONS});
		expect(JSON.parse(request.messages[0].content)).toEqual({
			transactions: [{...transaction, correlationId: '0'}],
		});
		expect(request.system[0].text).toContain('Use OTHER only when the evidence names a kind of spending');
		expect(request.system[0].text).toContain(
			'previousManualCategories holds a single category other than TRANSFER_OUT',
		);
		expect(request.system[0].text).toContain(
			'identifies only a payment processor, payment terminal provider or acquirer',
		);
		expect(request.system[0].text).toContain(
			'is REFUND only when counterpartyHistory lists an earlier payment by the owner to that body',
		);
	});

	it('sends a byte-identical cached prefix on every categorizing call and logs its cache use', async () => {
		const {provider, create} = setup({
			AI_CATEGORIZATION_MODEL: 'claude-sonnet-5-5',
			AI_CATEGORIZATION_EFFORT: 'medium',
		});
		const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
		const withUsage = (usage: Record<string, number>) => ({
			...response([classification()]),
			usage: {...usage, server_tool_use: {web_search_requests: 0}},
		});
		create
			.mockResolvedValueOnce(
				withUsage({
					input_tokens: 410,
					cache_creation_input_tokens: 3020,
					cache_read_input_tokens: 0,
					output_tokens: 150,
				}),
			)
			.mockResolvedValueOnce(
				withUsage({
					input_tokens: 395,
					cache_creation_input_tokens: 0,
					cache_read_input_tokens: 3020,
					output_tokens: 140,
				}),
			);
		try {
			await provider.categorize([input()], BANK_TRANSACTION_CATEGORY_DEFINITIONS);
			await provider.categorize(
				[{...input('transaction-2'), amount: '-99.00', ownerBank: {name: 'Example Bank', country: 'BE'}}],
				BANK_TRANSACTION_CATEGORY_DEFINITIONS,
			);
			const [[first], [second]] = create.mock.calls;
			expect(JSON.stringify([second.tools, second.system])).toBe(JSON.stringify([first.tools, first.system]));
			expect(second.messages).not.toEqual(first.messages);
			// One line per call with counts only: the second call reads the prefix the first one wrote.
			const lines = log.mock.calls.map(([message]) => String(message));
			expect(lines).toEqual([
				expect.stringMatching(
					new RegExp(
						'^Claude categorize call: items 1, claude-sonnet-5-5 medium, ' +
							`\\d+ ms, stop tool_use, input 410, cache read 0, cache write 3020, output 150, web searches 0$`,
					),
				),
				expect.stringMatching(/input 395, cache read 3020, cache write 0, output 140, web searches 0$/),
			]);
			expect(lines.join('\n')).not.toContain('Example Bank');
		} finally {
			log.mockRestore();
		}
	});

	it('keeps the shared contract limits equal to the app limits', () => {
		expect(contract.search.maxQueryLength).toBe(BANK_TRANSACTION_CATEGORIZATION_MAX_WEB_SEARCH_QUERY_LENGTH);
		expect(contract.search.maxSourceDomains).toBe(BANK_TRANSACTION_CATEGORIZATION_MAX_SEARCH_TRACE_ITEMS);
	});

	it('keeps the contract input schemas equal to the app input schema', () => {
		// Regenerate with `npm run contract:input`.
		expect(contract.input).toEqual(toInputContract().input);
	});

	it('keeps the shared contract enums equal to the app categories and evidence types', () => {
		const item = contract.schema.properties.classifications.items.properties;
		expect(item.category.enum).toEqual(BANK_TRANSACTION_CATEGORIES);
		expect(item.evidenceType.enum).toEqual(BANK_TRANSACTION_CATEGORIZATION_SEARCH_EVIDENCE_TYPES);
		expect(merchantContract.schema.properties.merchants.items.properties.kind.enum).toEqual(MERCHANT_KINDS);
	});

	it('sends the shared contract prompt and schema with only the StructuredOutput tool when no search query is given', async () => {
		const {provider, create} = setup();
		create.mockResolvedValue(response([classification()]));
		const [result] = await categorizeOn(provider, 'plain');
		expect(result).not.toHaveProperty('searchTrace');
		expect(create).toHaveBeenCalledTimes(1);
		const [[request]] = create.mock.calls;
		expect(request.system[0].text).toBe(contract.instructions);
		expect(request).toMatchObject(STRUCTURED_OUTPUT_REQUEST);
		expect(request.tools).toHaveLength(1);
		expect(Object.keys(JSON.parse(request.messages[0].content))).toEqual(['transactions']);
	});

	it('looks up a merchant the first answer asks for: the search gets only the query, a second call decides with the results', async () => {
		const {provider, create, search} = setup();
		search.mockResolvedValue(SEARCH_RESULTS);
		create
			.mockResolvedValueOnce(
				response([classification({category: 'NEEDS_REVIEW', evidenceType: 'INSUFFICIENT'})], {
					lookUpMerchant: true,
				}),
			)
			.mockResolvedValueOnce(response([classification({evidenceType: 'MERCHANT_IDENTITY_ONLY'})]));
		const transaction = {
			...input(),
			ownerBank: {name: 'Example Bank', country: 'NL'},
			bookingDate: '2026-09-02',
			valueDate: '2026-09-01',
			bankTransactionCode: 'PMNT',
			bankTransactionSubCode: 'CCRD',
			bankTransactionDescription: 'Example card purchase',
			merchantLocation: {city: 'Example City', region: 'Example Region', country: 'NL'},
			amount: '-42.17',
			remittanceInformation: 'synthetic-private-note',
			previousManualCategories: [
				{
					category: 'EATING_OUT' as const,
					count: 2,
					recentExamples: [
						{amount: '-9.99', currency: 'EUR', date: '2026-08-01', text: 'synthetic-history-note'},
					],
				},
			],
			sameAmountPayments: [
				{
					date: '2026-08-01',
					category: 'EATING_OUT' as const,
					source: 'MANUAL' as const,
					text: 'synthetic-note',
				},
				{date: '2026-07-01', category: 'EATING_OUT' as const, source: 'AI' as const, text: 'synthetic-ai-note'},
			],
			counterpartyHistory: [
				{
					date: '2026-06-01',
					amount: '-8.50',
					currency: 'EUR',
					direction: 'EXPENSE' as const,
					category: 'EATING_OUT' as const,
				},
			],
		};
		await expect(
			provider.categorize([transaction], BANK_TRANSACTION_CATEGORY_DEFINITIONS, {searchQuery: SEARCH_QUERY}),
		).resolves.toEqual([
			{
				correlationId: 'transaction-1',
				category: 'EATING_OUT',
				confidence: 0.9,
				provider: 'claude-api',
				model: 'claude-sonnet-5-5',
				searchTrace: {
					queries: [SEARCH_QUERY],
					sourceDomains: ['cafe.example.test', 'reviews.example.test'],
					evidenceType: 'MERCHANT_IDENTITY_ONLY',
				},
			},
		]);
		// The search API receives the code-built query and the owner's bank country, nothing else.
		expect(search.mock.calls).toEqual([[SEARCH_QUERY, 'NL']]);
		expect(create).toHaveBeenCalledTimes(2);
		const [[first], [second]] = create.mock.calls;
		expect(JSON.stringify([second.tools, second.system])).toBe(JSON.stringify([first.tools, first.system]));
		expect(JSON.parse(first.messages[0].content)).toEqual({transactions: [{...transaction, correlationId: '0'}]});
		expect(JSON.parse(second.messages[0].content)).toEqual({
			transactions: [{...transaction, correlationId: '0'}],
			merchantSearch: {query: SEARCH_QUERY, results: SEARCH_RESULTS},
		});
		// A change to the prompt, tools or messages these requests send, or to the input schema, changes the hash: bump the prompt version with it.
		const promptRequestFields = create.mock.calls.map(([{system, tools, tool_choice, messages}]) => ({
			system,
			tools,
			tool_choice,
			messages,
		}));
		const promptHash = createHash('sha256')
			.update(JSON.stringify({requests: promptRequestFields, input: toInputContract().input}))
			.digest('hex')
			.slice(0, 16);
		expect({version: BANK_TRANSACTION_CATEGORIZATION_PROMPT_VERSION, promptHash}).toEqual({
			version: 'bank-transaction-categorization-v21',
			promptHash: '5522886a28f41b4f',
		});
	});

	it('looks up the merchant when the first answer leaves an outgoing card payment in review without asking for a lookup', async () => {
		const {provider, create, search} = setup();
		search.mockResolvedValue(SEARCH_RESULTS);
		create
			.mockResolvedValueOnce(response([classification({category: 'NEEDS_REVIEW', evidenceType: 'INSUFFICIENT'})]))
			.mockResolvedValueOnce(
				response([classification({category: 'SHOPPING', evidenceType: 'MERCHANT_IDENTITY_ONLY'})]),
			);
		const [result] = await categorizeOn(provider, 'search');
		expect(result).toMatchObject({category: 'SHOPPING', searchTrace: {queries: [SEARCH_QUERY]}});
		expect(search.mock.calls).toEqual([[SEARCH_QUERY, undefined]]);
		expect(create).toHaveBeenCalledTimes(2);
	});

	it.each([
		['the first answer asks for no lookup', {lookUpMerchant: false, kind: 'search', category: 'EATING_OUT'}],
		[
			'a payment that is not by card is left in review without asking for a lookup',
			{lookUpMerchant: false, kind: 'search', category: 'NEEDS_REVIEW', transactionType: 'TRANSFER'},
		],
		[
			'an incoming card payment is left in review without asking for a lookup',
			{lookUpMerchant: false, kind: 'search', category: 'NEEDS_REVIEW', direction: 'INCOME'},
		],
		['the group has no merchant query', {lookUpMerchant: true, kind: 'plain', category: 'EATING_OUT'}],
		[
			'the first answer files it as a transfer to a person',
			{lookUpMerchant: true, kind: 'search', category: 'TRANSFER_OUT'},
		],
	] as const)('keeps the first answer without searching when %s', async (_case, testCase) => {
		const {lookUpMerchant, kind, category} = testCase;
		const {provider, create, search} = setup();
		create.mockResolvedValue(response([classification({category})], {lookUpMerchant}));
		const [result] = await provider.categorize(
			[
				{
					...input(),
					transactionType: 'transactionType' in testCase ? testCase.transactionType : 'CARD_PAYMENT',
					direction: 'direction' in testCase ? testCase.direction : 'EXPENSE',
				},
			],
			BANK_TRANSACTION_CATEGORY_DEFINITIONS,
			kind === 'search' ? {searchQuery: SEARCH_QUERY} : {},
		);
		expect(result).toMatchObject({category});
		expect(result).not.toHaveProperty('searchTrace');
		expect(search).not.toHaveBeenCalled();
		expect(create).toHaveBeenCalledTimes(1);
	});

	it.each([
		['the search is refused', () => Promise.reject(new BraveWebSearchError(402)), 'HTTP 402'],
		['the search fails', () => Promise.reject(new Error('synthetic search failure')), 'Error'],
		['the search finds nothing', () => Promise.resolve([]), null],
	])('keeps the first answer without a trace when %s', async (_case, outcome, logged) => {
		const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
		try {
			const {provider, create, search} = setup();
			search.mockImplementation(outcome);
			create.mockResolvedValue(response([classification({category: 'NEEDS_REVIEW'})], {lookUpMerchant: true}));
			const [result] = await categorizeOn(provider, 'search');
			expect(result).toMatchObject({category: 'NEEDS_REVIEW', provider: 'claude-api'});
			expect(result).not.toHaveProperty('searchTrace');
			expect(search).toHaveBeenCalledTimes(1);
			expect(create).toHaveBeenCalledTimes(1);
			expect(warn.mock.calls.map(([message]) => String(message))).toEqual(
				logged ? [expect.stringMatching(new RegExp(`${logged}$`))] : [],
			);
		} finally {
			warn.mockRestore();
		}
	});

	it('searches worldwide when the group holds rows from banks in different countries', async () => {
		const {provider, create, search} = setup();
		search.mockResolvedValue(SEARCH_RESULTS);
		create
			.mockResolvedValueOnce(
				response([classification(), classification({correlationId: '1'})], {lookUpMerchant: true}),
			)
			.mockResolvedValueOnce(response([classification(), classification({correlationId: '1'})]));
		await provider.categorize(
			[
				{...input('transaction-1'), ownerBank: {name: 'Example Bank', country: 'NL'}},
				{...input('transaction-2'), ownerBank: {name: 'Example Bank', country: 'DE'}},
			],
			BANK_TRANSACTION_CATEGORY_DEFINITIONS,
			{searchQuery: SEARCH_QUERY},
		);
		expect(search.mock.calls).toEqual([[SEARCH_QUERY, undefined]]);
	});

	it('fails the group when the call after a search fails, keeping nothing from the first answer', async () => {
		const {provider, create, search} = setup();
		search.mockResolvedValue(SEARCH_RESULTS);
		create
			.mockResolvedValueOnce(response([classification()], {lookUpMerchant: true}))
			.mockRejectedValueOnce({status: 500, message: 'synthetic'});
		await expect(outcomeOf(provider, 'search')).resolves.toBe('failed');
		expect(create).toHaveBeenCalledTimes(2);
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
		it.each(['max_tokens', 'pause_turn', 'refusal', 'end_turn'])(
			'fails a %s response that did not stop to call the tool',
			async (stopReason) => {
				const {provider, create} = setup();
				create.mockResolvedValue({...response([classification()]), stop_reason: stopReason});
				await expect(outcomeOf(provider, 'plain')).resolves.toBe('failed');
			},
		);
		it.each([
			[
				'answers in text instead of calling the tool',
				[{type: 'text', text: JSON.stringify({classifications: [classification()]})}],
			],
			['calls another tool', [structuredOutput({classifications: [classification()]}, 'web_search')]],
			[
				'calls the tool twice',
				[
					structuredOutput({classifications: [classification()]}),
					structuredOutput({classifications: [classification()]}),
				],
			],
			['passes a tool input that is not an object', [structuredOutput(JSON.stringify({classifications: []}))]],
		])('fails a reply that %s', async (_case, content) => {
			const {provider, create} = setup();
			create.mockResolvedValue({...response([]), content});
			await expect(outcomeOf(provider, 'plain')).resolves.toBe('failed');
		});
		it('reads the tool call when the reply also holds text', async () => {
			const {provider, create} = setup();
			const reply = response([classification({category: 'SHOPPING'})]);
			create.mockResolvedValue({
				...reply,
				content: [{type: 'text', text: 'Synthetic preface.'}, ...reply.content],
			});
			await expect(categorizeOn(provider, 'plain')).resolves.toMatchObject([{category: 'SHOPPING'}]);
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

	describe('failure classification', () => {
		it.each([
			['the API is rate limited', 429, 'pending'],
			['the API is overloaded', 529, 'pending'],
			['the API refuses the key', 401, 'pending'],
			['the API refuses access', 403, 'pending'],
			['the API always rejects the request', 400, 'failed'],
			['the API fails after accepting the request', 500, 'failed'],
		] as const)('ends a call where %s (%s) as %s', async (_case, status, expected) => {
			for (const kind of ['plain', 'search'] as const) {
				const {provider, create} = setup();
				create.mockRejectedValue({status, message: 'secret raw input'});
				await expect(outcomeOf(provider, kind)).resolves.toBe(expected);
				expect(create).toHaveBeenCalledTimes(1);
			}
		});

		it.each([
			[
				'the credit balance is too low',
				apiError(400, 'invalid_request_error', CREDIT_BALANCE_TOO_LOW),
				'pending',
			],
			[
				'the credit balance is too low, as an SDK error',
				new Anthropic.BadRequestError(
					400,
					{type: 'error', error: {type: 'invalid_request_error', message: CREDIT_BALANCE_TOO_LOW}},
					undefined,
					new Headers(),
				),
				'pending',
			],
			['billing fails', apiError(402, 'billing_error', 'synthetic billing failure'), 'pending'],
			['the connection never opens', new Anthropic.APIConnectionError({message: 'synthetic'}), 'pending'],
			['the request times out', new Anthropic.APIConnectionTimeoutError({message: 'synthetic'}), 'failed'],
			['the request is invalid', apiError(400, 'invalid_request_error', 'synthetic invalid field'), 'failed'],
			['the model does not exist', apiError(404, 'not_found_error', 'synthetic model'), 'failed'],
		] as const)('ends a call where %s as %s', async (_case, error, expected) => {
			for (const kind of ['plain', 'search'] as const) {
				const {provider, create} = setup();
				create.mockRejectedValue(error);
				await expect(outcomeOf(provider, kind)).resolves.toBe(expected);
			}
		});

		it('fails a categorizing reply that ran a web search, keeping nothing from it', async () => {
			for (const kind of ['plain', 'search'] as const) {
				const {provider, create} = setup();
				create.mockResolvedValueOnce(searchedResponse('Example Cafe menu'));
				await expect(outcomeOf(provider, kind)).resolves.toBe('failed');
				expect(create).toHaveBeenCalledTimes(1);
			}
		});

		it('fails a reply that does not validate', async () => {
			for (const reply of [
				response([{correlationId: '0', category: 'SHOPPING'}]),
				response([{correlationId: '0'}]),
			]) {
				const {provider, create} = setup();
				create.mockResolvedValue(reply);
				await expect(outcomeOf(provider, 'search')).resolves.toBe('failed');
			}
		});
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
			const provider = new ClaudeBankTransactionCategorizationProvider(config, {} as BraveWebSearchClient);
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

	it('returns a sanitized pending-retry error when the API is unavailable', async () => {
		const {provider, create} = setup();
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

		it('sends only merchant names with the merchant contract and keeps a well-formed official domain and a business’s company', async () => {
			const {provider, create} = setup();
			create.mockResolvedValue(
				merchantResponse([
					{
						correlationId: '0',
						kind: 'BUSINESS',
						brand: ' Example  Shop ',
						company: null,
						domain: 'WWW.Shop.Example.test',
						domainConfident: true,
					},
					{
						correlationId: '1',
						kind: 'BUSINESS',
						brand: 'Example Cafe',
						company: ' Example  Foods ',
						domain: 'https://cafe.example.test/',
						domainConfident: true,
					},
					{
						correlationId: '2',
						kind: 'PERSON',
						brand: 'Example Person',
						company: 'Example Person',
						domain: 'person.example.test',
						domainConfident: true,
					},
					{
						correlationId: '3',
						kind: 'PAYMENT_SERVICE',
						brand: 'Example Pay',
						company: 'Example Bank',
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
					// A business without a company sells under its own brand.
					company: 'Example Shop',
					domain: 'shop.example.test',
					domainConfident: true,
				},
				{
					correlationId: 'b',
					kind: 'BUSINESS',
					brand: 'Example Cafe',
					company: 'Example Foods',
					domain: null,
					domainConfident: false,
				},
				{correlationId: 'c', kind: 'PERSON', brand: null, company: null, domain: null, domainConfident: false},
				{
					correlationId: 'd',
					kind: 'PAYMENT_SERVICE',
					brand: 'Example Pay',
					// Money a payment service moved never groups under another business.
					company: 'Example Pay',
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

		it.each([
			['the credit balance is too low', apiError(400, 'invalid_request_error', CREDIT_BALANCE_TOO_LOW)],
			['the API is rate limited', {status: 429}],
			['the API refuses the key', {status: 401}],
			['the connection never opens', new Anthropic.APIConnectionError({message: 'synthetic'})],
		])('leaves merchants pending when %s', async (_case, error) => {
			const {provider, create} = setup();
			create.mockRejectedValue(error);
			await expect(provider.identifyMerchants([merchant()])).rejects.toBeInstanceOf(
				BankTransactionCategorizationUnavailableError,
			);
		});

		it.each([
			['the request is invalid', apiError(400, 'invalid_request_error', 'synthetic invalid field')],
			['the API fails after accepting the request', {status: 500}],
			['the request times out', new Anthropic.APIConnectionTimeoutError({message: 'synthetic'})],
		])('counts an attempt when %s', async (_case, error) => {
			const {provider, create} = setup();
			create.mockRejectedValue(error);
			const failure = await provider.identifyMerchants([merchant()]).catch((caught: unknown) => caught);
			expect(failure).toBeInstanceOf(BankTransactionCategorizationProviderError);
			expect(failure).not.toBeInstanceOf(BankTransactionCategorizationUnavailableError);
		});

		it('counts an attempt when the model answers for an unknown merchant', async () => {
			const {provider, create} = setup();
			create.mockResolvedValue(
				merchantResponse([
					{
						correlationId: '9',
						kind: 'UNCLEAR',
						brand: null,
						company: null,
						domain: null,
						domainConfident: false,
					},
				]),
			);
			await expect(provider.identifyMerchants([merchant()])).rejects.toMatchObject({
				name: 'BankTransactionCategorizationProviderError',
			});
		});
	});
});
