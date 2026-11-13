import Anthropic from '@anthropic-ai/sdk';
import {Logger} from '@nestjs/common';
import {BANK_TRANSACTION_CATEGORIES, BANK_TRANSACTION_CATEGORY_DEFINITIONS} from '@tempo/contracts';
import {createServer} from 'node:http';

import {ConfigurationService} from '@core/config/config.service';

import {AnthropicCreditAlert} from '../anthropic-credit-alert.service';
import {toBankTransactionCategorizationInput} from '../bank-transaction-categorization-input';
import {toInputContract} from '../bank-transaction-categorization-input.schema';
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

/** A call for one row, without a web search (`plain`) or with a merchant search query (`search`). */
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
	const creditAlert = creditAlertDouble();
	return {
		provider: new ClaudeBankTransactionCategorizationProvider(config, creditAlert, {messages: {create}} as never),
		create,
		creditAlert,
	};
}

function creditAlertDouble() {
	return {creditExhausted: jest.fn(), callSucceeded: jest.fn()} as unknown as jest.Mocked<AnthropicCreditAlert>;
}

function classification(overrides: Record<string, unknown> = {}) {
	return {correlationId: '0', category: 'FOOD_AND_DRINK', confidence: 0.9, evidenceType: 'MCC', ...overrides};
}

/** The categorizing call's reply: the answer as the input of its one StructuredOutput tool call. */
function response(classifications: unknown[]) {
	return {
		stop_reason: 'tool_use',
		content: [{type: 'thinking', thinking: '', signature: ''}, structuredOutput({classifications})],
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

/** The merchant search call's reply: one web search with `query` and the finding it reports. */
function searchReply({
	query = SEARCH_QUERY,
	finding = {identifies: 'BUSINESS', description: 'A cafe serving coffee and pastries.'} as object | string,
	searches = 1,
	results = [{type: 'web_search_result', url: 'https://www.cafe.example.test/menu?private=1'}] as unknown,
} = {}) {
	return {
		stop_reason: 'end_turn',
		usage: {server_tool_use: {web_search_requests: searches}},
		content: [
			{type: 'thinking', thinking: '', signature: ''},
			...(searches
				? [
						{type: 'server_tool_use', name: 'web_search', input: {query}},
						{type: 'web_search_tool_result', content: results},
					]
				: []),
			{type: 'text', text: typeof finding === 'string' ? finding : JSON.stringify(finding)},
		],
	};
}

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
			structuredOutput({classifications: [classification({evidenceType: 'MERCHANT_IDENTITY_ONLY'})]}),
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
		const {provider, create, creditAlert} = setup({
			AI_CATEGORIZATION_MODEL: model,
			AI_CATEGORIZATION_EFFORT: effort,
		});
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
		// An answered call ends a credit pause, which sends the operator one recovery note.
		expect(creditAlert.callSucceeded).toHaveBeenCalledTimes(1);
		expect(creditAlert.creditExhausted).not.toHaveBeenCalled();
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
		expect(JSON.parse(request.messages[0].content)).toEqual({
			categories: BANK_TRANSACTION_CATEGORY_DEFINITIONS,
			transactions: [{...input(), correlationId: '0'}],
		});
		expect(request.system).toContain('Use OTHER only when the evidence names a kind of spending');
		expect(request.system).toContain(
			'when previousManualCategories holds a single category other than TRANSFER_OUT',
		);
		expect(request.system).toContain('identifies only a payment processor, payment terminal provider or acquirer');
		expect(request).not.toHaveProperty('cache_control');
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
		expect(request.system).toBe(contract.instructions);
		expect(request).toMatchObject(STRUCTURED_OUTPUT_REQUEST);
		expect(request.tools).toHaveLength(1);
		expect(Object.keys(JSON.parse(request.messages[0].content))).toEqual(['categories', 'transactions']);
	});

	it('searches for the merchant in a call that receives only the query, then categorizes with its finding', async () => {
		const {provider, create} = setup();
		create
			.mockResolvedValueOnce(
				searchReply({
					results: [
						{type: 'web_search_result', url: 'https://www.cafe.example.test/menu?private=1'},
						{type: 'web_search_result', url: 'https://reviews.example.test/cafe'},
						{type: 'web_search_result', url: 'not a url'},
					],
				}),
			)
			.mockResolvedValueOnce(response([classification({evidenceType: 'MERCHANT_IDENTITY_ONLY'})]));
		const transaction = {
			...input(),
			amount: '-42.17',
			remittanceInformation: 'synthetic-private-note',
			previousManualCategories: [
				{
					category: 'FOOD_AND_DRINK' as const,
					count: 2,
					recentExamples: [
						{amount: '-9.99', currency: 'EUR', date: '2026-08-01', text: 'synthetic-history-note'},
					],
				},
			],
		};
		await expect(
			provider.categorize([transaction], BANK_TRANSACTION_CATEGORY_DEFINITIONS, {searchQuery: SEARCH_QUERY}),
		).resolves.toEqual([
			{
				correlationId: 'transaction-1',
				category: 'FOOD_AND_DRINK',
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
		expect(create).toHaveBeenCalledTimes(2);
		const [[searchRequest], [categorizeRequest]] = create.mock.calls;
		// The whole searching request: the query is the only input it carries.
		expect(searchRequest).toEqual({
			model: 'claude-sonnet-5-5',
			max_tokens: 4096,
			system: contract.search.instructions,
			messages: [{role: 'user', content: JSON.stringify({query: SEARCH_QUERY})}],
			thinking: {type: 'adaptive'},
			output_config: {effort: 'low', format: {type: 'json_schema', schema: contract.search.schema}},
			tools: [{type: 'web_search_20250305', name: 'web_search', max_uses: 1, allowed_callers: ['direct']}],
		});
		expect(JSON.stringify(searchRequest)).not.toMatch(
			/42\.17|9\.99|synthetic-private-note|synthetic-history-note|transaction-1|5814|2026-0/,
		);
		expect(categorizeRequest.system).toBe(contract.instructions);
		expect(categorizeRequest.tools).toEqual(STRUCTURED_OUTPUT_REQUEST.tools);
		expect(JSON.parse(categorizeRequest.messages[0].content)).toEqual({
			categories: BANK_TRANSACTION_CATEGORY_DEFINITIONS,
			transactions: [{...transaction, correlationId: '0'}],
			searchFinding: {
				query: SEARCH_QUERY,
				identifies: 'BUSINESS',
				description: 'A cafe serving coffee and pastries.',
			},
		});
	});

	it('records the query the search ran and passes a bounded description', async () => {
		const {provider, create} = setup();
		const ranQuery = `${SEARCH_QUERY} Example City`;
		create
			.mockResolvedValueOnce(
				searchReply({
					query: ranQuery,
					finding: {identifies: 'PAYMENT_PROCESSOR', description: ` ${'x'.repeat(400)} `},
				}),
			)
			.mockResolvedValueOnce(response([classification({category: 'NEEDS_REVIEW', evidenceType: 'INSUFFICIENT'})]))
			.mockResolvedValueOnce(searchReply({finding: {identifies: 'BUSINESS', description: '  '}}))
			.mockResolvedValueOnce(response([classification()]));
		const [processor] = await categorizeOn(provider, 'search');
		const [business] = await categorizeOn(provider, 'search');
		expect(processor.searchTrace?.queries).toEqual([ranQuery]);
		expect(business.searchTrace?.queries).toEqual([SEARCH_QUERY]);
		const findings = [1, 3].map((call) => JSON.parse(create.mock.calls[call][0].messages[0].content).searchFinding);
		expect(findings).toEqual([
			{query: ranQuery, identifies: 'PAYMENT_PROCESSOR', description: 'x'.repeat(300)},
			{query: SEARCH_QUERY, identifies: 'BUSINESS', description: null},
		]);
	});

	it.each(['NOTHING', 'PERSON'])(
		'keeps the trace of a search that found %s but sends no finding',
		async (identifies) => {
			const {provider, create} = setup();
			create
				.mockResolvedValueOnce(searchReply({finding: {identifies, description: 'Example Person'}}))
				.mockResolvedValueOnce(
					response([classification({category: 'NEEDS_REVIEW', evidenceType: 'INSUFFICIENT'})]),
				);
			const [result] = await categorizeOn(provider, 'search');
			expect(result.searchTrace).toEqual({
				queries: [SEARCH_QUERY],
				sourceDomains: ['cafe.example.test'],
				evidenceType: 'INSUFFICIENT',
			});
			expect(JSON.parse(create.mock.calls[1][0].messages[0].content)).not.toHaveProperty('searchFinding');
		},
	);

	it.each([
		['the search call fails', {status: 500}],
		['the search call is refused', {status: 429}],
		['the search reply is not a finding', searchReply({finding: 'not json'})],
		['the search reply has an unknown finding', searchReply({finding: {identifies: 'SHOP', description: null}})],
		['the model answers without searching', searchReply({searches: 0})],
		[
			'the search tool returns an error',
			searchReply({results: {type: 'web_search_tool_result_error', error_code: 'unavailable'}}),
		],
		['the reply ran more than one search', searchReply({searches: 2})],
		[
			'the reply invoked the search twice',
			(() => {
				const reply = searchReply();
				const [thinking, ...rest] = reply.content;
				const retry = [
					{type: 'server_tool_use', name: 'web_search', input: {query: `${SEARCH_QUERY} menu`}},
					{
						type: 'web_search_tool_result',
						content: {type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded'},
					},
				];
				return {...reply, content: [thinking, ...rest.slice(0, 2), ...retry, ...rest.slice(2)]};
			})(),
		],
		['the search reply is cut off', {...searchReply(), stop_reason: 'max_tokens'}],
	])('categorizes without a finding or trace when %s', async (_case, searchOutcome) => {
		const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
		try {
			const {provider, create} = setup();
			if ('status' in searchOutcome) create.mockRejectedValueOnce(searchOutcome);
			else create.mockResolvedValueOnce(searchOutcome);
			create.mockResolvedValueOnce(response([classification({category: 'NEEDS_REVIEW'})]));
			const [result] = await categorizeOn(provider, 'search');
			expect(result).toMatchObject({category: 'NEEDS_REVIEW', provider: 'claude-api'});
			expect(result).not.toHaveProperty('searchTrace');
			expect(create).toHaveBeenCalledTimes(2);
			const categorizeRequest = create.mock.calls[1][0];
			expect(categorizeRequest.tools).toEqual(STRUCTURED_OUTPUT_REQUEST.tools);
			expect(JSON.parse(categorizeRequest.messages[0].content)).not.toHaveProperty('searchFinding');
		} finally {
			warn.mockRestore();
		}
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
		] as const)('ends a call where %s (%s) as %s without a credit alert', async (_case, status, expected) => {
			for (const kind of ['plain', 'search'] as const) {
				const {provider, create, creditAlert} = setup();
				create.mockRejectedValue({status, message: 'secret raw input'});
				await expect(outcomeOf(provider, kind)).resolves.toBe(expected);
				// A failed merchant search leaves the categorizing call to decide the outcome.
				expect(create).toHaveBeenCalledTimes(kind === 'search' ? 2 : 1);
				expect(creditAlert.creditExhausted).not.toHaveBeenCalled();
				expect(creditAlert.callSucceeded).not.toHaveBeenCalled();
			}
		});

		it.each([
			[
				'the credit balance is too low',
				apiError(400, 'invalid_request_error', CREDIT_BALANCE_TOO_LOW),
				'pending',
				'alerts',
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
				'alerts',
			],
			['billing fails', apiError(402, 'billing_error', 'synthetic billing failure'), 'pending', 'alerts'],
			['the API asks for payment', {status: 402, message: 'synthetic'}, 'pending', 'alerts'],
			[
				'billing fails with another status',
				apiError(400, 'billing_error', 'synthetic billing failure'),
				'pending',
				'alerts',
			],
			[
				'the connection never opens',
				new Anthropic.APIConnectionError({message: 'synthetic'}),
				'pending',
				'stays quiet',
			],
			[
				'the request times out',
				new Anthropic.APIConnectionTimeoutError({message: 'synthetic'}),
				'failed',
				'stays quiet',
			],
			[
				'the request is invalid',
				apiError(400, 'invalid_request_error', 'synthetic invalid field'),
				'failed',
				'stays quiet',
			],
			['the model does not exist', apiError(404, 'not_found_error', 'synthetic model'), 'failed', 'stays quiet'],
		] as const)('ends a call where %s as %s and %s to the operator', async (_case, error, expected, alert) => {
			for (const kind of ['plain', 'search'] as const) {
				const {provider, create, creditAlert} = setup();
				create.mockRejectedValue(error);
				await expect(outcomeOf(provider, kind)).resolves.toBe(expected);
				expect(creditAlert.creditExhausted).toHaveBeenCalledTimes(alert === 'alerts' ? 1 : 0);
				expect(creditAlert.callSucceeded).not.toHaveBeenCalled();
			}
		});

		it('fails a categorizing reply that ran a web search, keeping nothing from it', async () => {
			for (const kind of ['plain', 'search'] as const) {
				const {provider, create} = setup();
				if (kind === 'search') create.mockResolvedValueOnce(searchReply());
				create.mockResolvedValueOnce(searchedResponse('Example Cafe menu'));
				await expect(outcomeOf(provider, kind)).resolves.toBe('failed');
				expect(create).toHaveBeenCalledTimes(kind === 'search' ? 2 : 1);
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
			const provider = new ClaudeBankTransactionCategorizationProvider(config, creditAlertDouble());
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

		it.each([
			['the credit balance is too low', apiError(400, 'invalid_request_error', CREDIT_BALANCE_TOO_LOW), 1],
			['the API is rate limited', {status: 429}, 0],
			['the API refuses the key', {status: 401}, 0],
			['the connection never opens', new Anthropic.APIConnectionError({message: 'synthetic'}), 0],
		])('leaves merchants pending when %s', async (_case, error, alerts) => {
			const {provider, create, creditAlert} = setup();
			create.mockRejectedValue(error);
			await expect(provider.identifyMerchants([merchant()])).rejects.toBeInstanceOf(
				BankTransactionCategorizationUnavailableError,
			);
			expect(creditAlert.creditExhausted).toHaveBeenCalledTimes(alerts);
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
					{correlationId: '9', kind: 'UNCLEAR', brand: null, domain: null, domainConfident: false},
				]),
			);
			await expect(provider.identifyMerchants([merchant()])).rejects.toMatchObject({
				name: 'BankTransactionCategorizationProviderError',
			});
		});
	});
});
