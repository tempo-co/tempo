import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {BANK_TRANSACTION_CATEGORY_DEFINITIONS} from '@tempo/contracts';

import {ToolReadError} from './errors';
import {filtersSchema} from './inputs';
import {ToolReader, createToolServer} from './tools';

const ID = '00000000-0000-4000-8000-000000000001';
const MERCHANT = `k_${'0123456789abcdef'.repeat(2)}`;

/** The smallest valid input for each tool; the override cases add one unknown field to it. */
const VALID_INPUTS: Record<string, Record<string, unknown>> = {
	list_accounts: {},
	list_recurring: {},
	recurring_summary: {},
	month_summary: {month: '2040-01'},
	cash_flow: {interval: 'month', from: '2040-01-01', to: '2040-01-02'},
	balance_trend: {interval: 'month', from: '2040-01-01', to: '2040-01-02'},
	list_categories: {},
	search_transactions: {},
	transaction_totals: {},
	get_transaction: {id: ID},
	review_counts: {},
	spending_breakdown: {interval: 'month', by: 'category', from: '2040-01-01', to: '2040-01-02'},
	list_merchants: {},
	merchant_ranking: {interval: 'month', period: '2040-01-01'},
	get_merchant: {id: MERCHANT},
	merchant_periods: {id: MERCHANT, interval: 'month', from: '2040-01-01', to: '2040-01-02'},
};

type ToolCase = [string, Record<string, unknown>, string];

const INVALID_INPUTS: ToolCase[] = [
	...[
		{},
		{by: 'amount'},
		{order: 'ASC'},
		{by: 'id', order: 'ASC'},
		{by: 'amount', order: 'asc'},
		{by: 'bookingDate', order: 'DESC', accountId: ID},
		'amount',
		null,
	].map((sort): ToolCase => ['search_transactions', {sort}, 'complete strict API sort']),
	['transaction_totals', {sort: {by: 'amount', order: 'ASC'}}, 'totals only accepts filters'],
	...['search_transactions', 'transaction_totals'].flatMap((name) =>
		[
			'',
			'a'.repeat(31),
			'a'.repeat(33),
			'A'.repeat(32),
			'g'.repeat(32),
			` ${'a'.repeat(32)}`,
			`${'a'.repeat(32)}\n`,
			ID,
			7,
			null,
		].map((recurringSeriesKey): ToolCase => [name, {filters: {recurringSeriesKey}}, '32 lowercase hex series key']),
	),
	['recurring_summary', {asOf: '2041-02-29'}, 'recurring summary calendar date'],
	['recurring_summary', {asOf: '2040-02-03T00:00:00Z'}, 'recurring summary date without time'],
	['recurring_summary', {asOf: null}, 'recurring summary date is not null'],
	['list_recurring', {asOf: '2041-02-29'}, 'recurring calendar date'],
	['list_recurring', {asOf: '2040-02-03T00:00:00Z'}, 'recurring date without time'],
	['list_recurring', {asOf: null}, 'recurring date is not null'],
	['month_summary', {}, 'missing month'],
	['month_summary', {month: '2100-01'}, 'month year bound'],
	['month_summary', {month: '2040-13'}, 'month calendar bound'],
	['month_summary', {month: '2040-2'}, 'month format'],
	['month_summary', {month: '2040-02', asOf: '2041-02-29'}, 'calendar leap day'],
	['month_summary', {month: '2040-02', asOf: '2040-02-03T00:00:00Z'}, 'date without time'],
	['cash_flow', {interval: 'day', from: '2040-01-01', to: '2040-01-02'}, 'interval enum'],
	['balance_trend', {interval: 'year', from: '2040-00-01', to: '2040-01-02'}, 'calendar date'],
	['cash_flow', {interval: 'week', from: '2040-01-01'}, 'required range'],
	['get_transaction', {id: '../summary'}, 'path injection'],
	['get_transaction', {id: '00000000-0000-1000-8000-000000000001'}, 'UUID version'],
	['get_transaction', {id: ID.replaceAll('-', '')}, 'UUID format'],
	['spending_breakdown', {interval: 'week', by: 'category', from: '2040-01-01', to: '2040-01-02'}, 'interval'],
	['spending_breakdown', {interval: 'month', by: 'merchant', from: '2040-01-01', to: '2040-01-02'}, 'dimension'],
	['spending_breakdown', {interval: 'month', from: '2040-01-01', to: '2040-01-02'}, 'required dimension'],
	['spending_breakdown', {interval: 'year', by: 'source', from: '2040-02-30', to: '2040-03-01'}, 'calendar date'],
	['list_merchants', {search: '€'.repeat(201)}, 'merchant search length'],
	['list_merchants', {offset: -1}, 'nonnegative offset'],
	['list_merchants', {limit: 0}, 'merchant limit minimum'],
	['list_merchants', {limit: 101}, 'merchant limit maximum'],
	['list_merchants', {limit: '10'}, 'numeric limit'],
	['merchant_ranking', {interval: 'month'}, 'required period'],
	['merchant_ranking', {interval: 'day', period: '2040-01-01'}, 'ranking interval'],
	['merchant_ranking', {interval: 'month', period: '2040-01-01', limit: 201}, 'ranking limit maximum'],
	['merchant_ranking', {interval: 'month', period: '2040-01-01', limit: 1.5}, 'integer ranking limit'],
	...['../summary', `x_${'0'.repeat(32)}`, `k_${'0'.repeat(31)}`, `k_${'A'.repeat(32)}`, ID].map((id): ToolCase => [
		'get_merchant',
		{id},
		'merchant group id',
	]),
	['merchant_periods', {id: `../${'0'.repeat(32)}`, interval: 'month', from: '2040-01-01', to: '2040-01-02'}, 'id'],
	['merchant_periods', {id: `b_${'0'.repeat(32)}`, interval: 'month', from: '2040-01-01'}, 'required range'],
	['search_transactions', {page: -1}, 'nonnegative page'],
	['search_transactions', {page: 1.5}, 'integer page'],
	['search_transactions', {page: '1'}, 'numeric page'],
	['search_transactions', {pageSize: 101}, 'page maximum'],
	['search_transactions', {pageSize: 25}, 'DTO page-size enum'],
	['search_transactions', {pageSize: 0}, 'page minimum'],
	['search_transactions', {filters: {search: '€'.repeat(1001)}}, 'search length'],
	['search_transactions', {filters: {search: '😀'.repeat(1001)}}, 'search length in characters'],
	['search_transactions', {filters: {search: 7}}, 'string search'],
	['search_transactions', {filters: {bookingDate: {from: '2040-04-31'}}}, 'booking date'],
	['search_transactions', {filters: {bankAccountIds: ['bad-id']}}, 'bank account UUID'],
	['search_transactions', {filters: {categories: ['INVALID']}}, 'category enum'],
	['search_transactions', {filters: {categorySources: ['INVALID']}}, 'source enum'],
	['search_transactions', {filters: {financialEventTypes: ['INVALID']}}, 'financial event enum'],
	['search_transactions', {filters: {cashFlows: ['EXPENSE']}}, 'cash flow enum'],
	['search_transactions', {filters: {baseAmount: 'INVALID'}}, 'base amount enum'],
	['search_transactions', {filters: {categoryStatuses: ['PENDING']}}, 'category status filter enum'],
	['search_transactions', {filters: {cashFlows: 'SPENDING'}}, 'array filter'],
	['transaction_totals', {page: 1}, 'no totals pagination'],
	['transaction_totals', {filters: {accountId: ID}}, 'no filter owner override'],
	[
		'search_transactions',
		{filters: {bookingDate: {from: '2040-01-01', origin: 'https://example.test'}}},
		'strict nested date filter',
	],
];

describe('MCP tool registration', () => {
	let client: Client;
	let close: () => Promise<void>;
	let calls: [string, unknown[]][];
	let now: Date;
	let respond: (method: string) => Promise<unknown>;

	beforeEach(async () => {
		calls = [];
		now = new Date('2040-02-02T23:30:00Z');
		respond = async () => ({ok: true});
		const reader = new Proxy({} as ToolReader, {
			get:
				(_target, method: string) =>
				(...args: unknown[]) => {
					calls.push([method, args]);
					return respond(method);
				},
		});
		const server = createToolServer(reader, 'Europe/Amsterdam', () => now);
		client = new Client({name: 'synthetic-test', version: '1'});
		const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
		await server.connect(serverTransport);
		await client.connect(clientTransport);
		close = async () => {
			await client.close();
			await server.close();
		};
	});

	afterEach(() => close());

	const call = (name: string, args: Record<string, unknown> = {}) =>
		client.callTool({name, arguments: args}) as Promise<CallToolResult>;

	const json = (result: CallToolResult) => {
		expect(result.isError).toBeUndefined();
		expect(result.content).toHaveLength(1);
		const [content] = result.content;
		if (content.type !== 'text') throw new Error('expected text content');
		const value = JSON.parse(content.text);
		expect(content.text).toBe(JSON.stringify(value));
		return value;
	};

	it('reads every tool through the owner reader with Amsterdam-dated defaults and returns compact JSON', async () => {
		const body = {total: '9007199254740993.01', unconverted: null};
		respond = async () => body;
		const filters = {
			bookingDate: {from: '2040-01-01', to: '2040-02-01'},
			bankAccountIds: [ID],
			search: 'Example € & Store',
			categories: ['FOOD_AND_DRINK', 'UNCATEGORIZED'],
			categorySources: ['MANUAL'],
			financialEventTypes: ['OWN_TRANSFER'],
			cashFlows: ['SPENDING'],
			baseAmount: 'PRESENT',
			categoryStatuses: ['CATEGORIZING'],
			recurringSeriesKey: '0123456789abcdef'.repeat(2),
		};
		const period = {interval: 'month', from: '2040-01-01', to: '2040-02-01'};
		const cases: [string, Record<string, unknown>, string, unknown[]][] = [
			['list_accounts', {}, 'listAccounts', []],
			['list_recurring', {}, 'listRecurring', [{asOf: '2040-02-03'}]],
			['list_recurring', {asOf: '2040-02-29'}, 'listRecurring', [{asOf: '2040-02-29'}]],
			['recurring_summary', {}, 'recurringSummary', [{asOf: '2040-02-03'}]],
			['month_summary', {month: '2040-02'}, 'monthSummary', [{month: '2040-02', asOf: '2040-02-03'}]],
			['cash_flow', period, 'cashFlow', [{...period, asOf: '2040-02-03'}]],
			[
				'balance_trend',
				{...period, interval: 'week', asOf: '2040-02-02'},
				'balanceTrend',
				[{...period, interval: 'week', asOf: '2040-02-02'}],
			],
			['search_transactions', {}, 'searchTransactions', [{page: 0, pageSize: 10}]],
			[
				'search_transactions',
				{filters, sort: {by: 'amount', order: 'DESC'}, page: 2, pageSize: 100},
				'searchTransactions',
				[{filters, sort: {by: 'amount', order: 'DESC'}, page: 2, pageSize: 100}],
			],
			['transaction_totals', {filters}, 'transactionTotals', [{filters}]],
			['get_transaction', {id: ID}, 'getTransaction', [ID]],
			['review_counts', {}, 'reviewCounts', []],
			[
				'spending_breakdown',
				{interval: 'year', by: 'category', from: '2039-01-01', to: '2040-02-03'},
				'spendingBreakdown',
				[{interval: 'year', by: 'category', from: '2039-01-01', to: '2040-02-03', asOf: '2040-02-03'}],
			],
			['list_merchants', {}, 'listMerchants', [{}]],
			[
				'list_merchants',
				{search: 'Example € & Shop', offset: 0, limit: 100},
				'listMerchants',
				[{search: 'Example € & Shop', offset: 0, limit: 100}],
			],
			[
				'merchant_ranking',
				{interval: 'month', period: '2040-02-01'},
				'merchantRanking',
				[{interval: 'month', period: '2040-02-01', asOf: '2040-02-03'}],
			],
			['get_merchant', {id: MERCHANT}, 'getMerchant', [MERCHANT]],
			[
				'merchant_periods',
				{id: MERCHANT, ...period},
				'merchantPeriods',
				[MERCHANT, {...period, asOf: '2040-02-03'}],
			],
		];
		for (const [name, args, method, readerArgs] of cases) {
			calls = [];
			expect(json(await call(name, args))).toEqual(body);
			// Optional inputs the caller left out reach the reader as absent, so the API defaults apply.
			expect(JSON.parse(JSON.stringify(calls))).toEqual([[method, readerArgs]]);
		}

		now = new Date('2040-07-02T22:30:00Z');
		calls = [];
		await call('list_recurring');
		expect(calls).toEqual([['listRecurring', [{asOf: '2040-07-03'}]]]);

		const {tools} = await client.listTools();
		expect(tools.map(({name}) => name).sort()).toEqual(Object.keys(VALID_INPUTS).sort());
		for (const tool of tools)
			expect(tool.annotations).toEqual({
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: true,
			});
		expect(tools.find(({name}) => name === 'search_transactions')?.description).toMatch(/transaction_totals/);
		expect(tools.find(({name}) => name === 'merchant_periods')?.description).toMatch(/list_merchants/);
	});

	it('lists the shared category definitions with an uncategorized filter without reading', async () => {
		expect(json(await call('list_categories'))).toEqual([
			...BANK_TRANSACTION_CATEGORY_DEFINITIONS,
			{value: 'UNCATEGORIZED', label: 'Uncategorized', description: 'Filter transactions without a category.'},
		]);
		expect(calls).toEqual([]);
	});

	it.each(INVALID_INPUTS)('refuses %s input before reading: %j (%s)', async (name, args) => {
		expect((await call(name, args)).isError).toBe(true);
		expect(calls).toEqual([]);
	});

	it.each(
		Object.entries(VALID_INPUTS).flatMap(([name, args]) =>
			[
				['accountId', ID],
				['token', 'synthetic-caller-token'],
				['origin', 'https://example.test'],
			].map(([key, value]): [string, string, Record<string, unknown>] => [name, key, {...args, [key]: value}]),
		),
	)('refuses a caller-supplied override on %s: %s', async (name, _key, args) => {
		expect((await call(name, args)).isError).toBe(true);
		expect(calls).toEqual([]);
	});

	it('accepts DTO boundary values and passes them to the reader unchanged', async () => {
		expect(filtersSchema.safeParse({search: '❤️'.repeat(1000)}).success).toBe(true);
		for (const pageSize of [5, 10, 20, 30, 40, 50, 100])
			json(await call('search_transactions', {pageSize, filters: {search: '€'.repeat(1000)}}));
		json(await call('search_transactions', {filters: {search: '😀'.repeat(1000)}}));
		for (const month of ['1900-01', '2099-12']) json(await call('month_summary', {month, asOf: '2099-12-31'}));
		for (const args of [{search: '❤️'.repeat(200), offset: 0, limit: 1}, {limit: 100}])
			json(await call('list_merchants', args));
		for (const limit of [1, 200])
			json(await call('merchant_ranking', {interval: 'week', period: '2040-01-01', asOf: '2040-01-01', limit}));
		expect(calls.map(([method, [input]]) => [method, input])).toEqual(
			[
				...[5, 10, 20, 30, 40, 50, 100].map((pageSize) => [
					'searchTransactions',
					{filters: {search: '€'.repeat(1000)}, page: 0, pageSize},
				]),
				['searchTransactions', {filters: {search: '😀'.repeat(1000)}, page: 0, pageSize: 10}],
				['monthSummary', {month: '1900-01', asOf: '2099-12-31'}],
				['monthSummary', {month: '2099-12', asOf: '2099-12-31'}],
				['listMerchants', {search: '❤️'.repeat(200), offset: 0, limit: 1}],
				['listMerchants', {limit: 100}],
				['merchantRanking', {interval: 'week', period: '2040-01-01', asOf: '2040-01-01', limit: 1}],
				['merchantRanking', {interval: 'week', period: '2040-01-01', asOf: '2040-01-01', limit: 200}],
			].map(([method, input]) => [method, expect.objectContaining(input as object)]),
		);
	});

	it.each([
		[400, 'Tempo API HTTP 400: Request refused. Check tool input.'],
		[401, 'Tempo API HTTP 401: Token rejected or expired.'],
		[403, 'Tempo API HTTP 403: Permission denied. Check token scope and account access.'],
		[404, 'Tempo API HTTP 404: Resource not found or not accessible to this token.'],
		[422, 'Tempo API HTTP 422: Request refused. Check tool input.'],
		[429, 'Tempo API HTTP 429: Rate limit reached. Retry later.'],
		[503, 'Tempo API HTTP 503: Tempo API unavailable. Retry later.'],
	])('returns static error text when a read fails with HTTP %i', async (status, text) => {
		respond = async () => {
			throw new ToolReadError(status);
		};
		expect(await call('get_merchant', {id: MERCHANT})).toEqual({isError: true, content: [{type: 'text', text}]});
	});

	it('returns static error text without the raw message when a read fails unexpectedly', async () => {
		respond = async () => {
			throw new Error('example-private-failure synthetic-test-token');
		};
		expect(await call('list_accounts')).toEqual({
			isError: true,
			content: [{type: 'text', text: 'Tempo API HTTP 500: Tempo API unavailable. Retry later.'}],
		});
	});
});
