import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {z} from 'zod';
import {CATEGORY_DEFINITIONS} from './categories.generated.js';
import {filtersSchema, filterQuery} from './inputs.js';
import {loadConfig} from './config.js';
import {createApiReader} from './api.js';

export interface ServerOptions {
	apiUrl?: string;
	apiToken?: string;
	now?: () => Date;
}

export function createServer(options: ServerOptions): McpServer {
	const {apiUrl, apiToken} = loadConfig({TEMPO_API_URL: options.apiUrl, TEMPO_API_TOKEN: options.apiToken});
	const server = new McpServer({name: 'tempo-local', version: '0.1.0'});
	const annotations = {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true};
	const get = createApiReader({apiUrl, apiToken});
	const today = () =>
		new Intl.DateTimeFormat('en-CA', {
			timeZone: 'Europe/Amsterdam',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
		}).format((options.now ?? (() => new Date()))());
	server.registerTool(
		'month_summary',
		{
			description:
				'Monthly spending and income with baseline comparisons. asOf defaults to today in Europe/Amsterdam.',
			inputSchema: z.strictObject({
				month: z.string().regex(/^(19|20)\d{2}-(0[1-9]|1[0-2])$/),
				asOf: z.iso.date().optional(),
			}),
			annotations,
		},
		async ({month, asOf}) => get('/bank-transactions/summary', {month, asOf: asOf ?? today()}),
	);
	for (const [name, route] of [
		['cash_flow', 'cash-flow'],
		['balance_trend', 'balance-trend'],
	]) {
		server.registerTool(
			name,
			{
				description:
					'Read period analytics. asOf defaults to today in Europe/Amsterdam. API enforces range limits: week 104, month 60, year 10 periods; to must be on or before asOf.',
				inputSchema: z.strictObject({
					interval: z.enum(['week', 'month', 'year']),
					from: z.iso.date(),
					to: z.iso.date(),
					asOf: z.iso.date().optional(),
				}),
				annotations,
			},
			async ({interval, from, to, asOf}) =>
				get(`/bank-transactions/${route}`, {interval, from, to, asOf: asOf ?? today()}),
		);
	}
	server.registerTool(
		'list_categories',
		{
			description: 'Category values and descriptions, including the UNCATEGORIZED filter.',
			inputSchema: z.strictObject({}),
			annotations,
		},
		async () => ({
			content: [
				{
					type: 'text',
					text: JSON.stringify([
						...CATEGORY_DEFINITIONS,
						{
							value: 'UNCATEGORIZED',
							label: 'Uncategorized',
							description: 'Filter transactions without a category.',
						},
					]),
				},
			],
		}),
	);
	server.registerTool(
		'search_transactions',
		{
			description:
				'Search one page of transactions. page is zero-based. Use transaction_totals with the same filters for sums across all matches; never sum a page as a full total.',
			inputSchema: z.strictObject({
				filters: filtersSchema.optional(),
				page: z.int().min(0).default(0),
				pageSize: z
					.union([
						z.literal(5),
						z.literal(10),
						z.literal(20),
						z.literal(30),
						z.literal(40),
						z.literal(50),
						z.literal(100),
					])
					.default(10),
			}),
			annotations,
		},
		async ({filters, page, pageSize}) => {
			const query = new URLSearchParams({
				'pagination[pageIndex]': String(page),
				'pagination[pageSize]': String(pageSize),
			});
			for (const [key, value] of filterQuery(filters)) query.append(key, value);
			return get('/bank-transactions', query);
		},
	);
	server.registerTool(
		'transaction_totals',
		{
			description:
				'Exact decimal-string spending, income and net across ALL matching transactions, plus count and excluded unknownDirection/missingBaseAmount counts. Uses Tempo base-currency and spending semantics, not a page sum.',
			inputSchema: z.strictObject({filters: filtersSchema.optional()}),
			annotations,
		},
		async ({filters}) => get('/bank-transactions/totals', filterQuery(filters)),
	);
	server.registerTool(
		'get_transaction',
		{
			description: 'Get a single owner-scoped transaction by UUIDv4.',
			inputSchema: z.strictObject({id: z.uuidv4()}),
			annotations,
		},
		async ({id}) => get(`/bank-transactions/${id}`),
	);
	server.registerTool(
		'review_counts',
		{
			description: 'Read counts of transactions needing review or categorization.',
			inputSchema: z.strictObject({}),
			annotations,
		},
		async () => get('/bank-transactions/review-counts'),
	);
	server.registerTool(
		'list_accounts',
		{
			description: 'List bank connections, accounts, balances, base currency and sync freshness.',
			inputSchema: z.strictObject({}),
			annotations,
		},
		async () => get('/bank-connections'),
	);
	return server;
}
