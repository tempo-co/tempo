import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {z} from 'zod';
import {
	BANK_TRANSACTION_CATEGORY_DEFINITIONS,
	BANK_TRANSACTION_UNCATEGORIZED,
	type BankBalanceTrend,
	type BankConnection,
	type BankTransaction,
	type BankTransactionCashFlow,
	type BankTransactionCashFlowQuery,
	type BankTransactionReviewCounts,
	type BankTransactionSummary,
	type BankTransactionSummaryQuery,
	type BankTransactionTotals,
	type BankTransactionsResponse,
	type RecurringSeriesLists,
	type RecurringSeriesQuery,
	type RecurringSummary,
} from '@tempo/contracts';
import {filtersSchema, sortSchema} from './inputs.js';
import {ToolReadError} from './errors.js';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';

export type PeriodInput = BankTransactionCashFlowQuery;

export type TransactionFilters = z.infer<typeof filtersSchema>;
export type TransactionSort = z.infer<typeof sortSchema>;

/** Operations return the public REST response shape, never persistence entities. */
export interface ToolReader {
	listAccounts(): Promise<BankConnection[]>;
	listRecurring(input: RecurringSeriesQuery): Promise<RecurringSeriesLists>;
	recurringSummary(input: RecurringSeriesQuery): Promise<RecurringSummary>;
	monthSummary(input: BankTransactionSummaryQuery): Promise<BankTransactionSummary>;
	cashFlow(input: PeriodInput): Promise<BankTransactionCashFlow>;
	balanceTrend(input: PeriodInput): Promise<BankBalanceTrend>;
	searchTransactions(input: {
		filters?: TransactionFilters;
		sort?: TransactionSort;
		page: number;
		pageSize: number;
	}): Promise<BankTransactionsResponse>;
	transactionTotals(input: {filters?: TransactionFilters}): Promise<BankTransactionTotals>;
	getTransaction(id: string): Promise<BankTransaction>;
	reviewCounts(): Promise<BankTransactionReviewCounts>;
}

export function createToolServer(reader: ToolReader, now: () => Date = () => new Date()): McpServer {
	const server = new McpServer({name: 'tempo-local', version: '0.1.0'});
	const annotations = {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true};
	const read = async (operation: () => Promise<unknown>): Promise<CallToolResult> => {
		try {
			return {content: [{type: 'text', text: JSON.stringify(await operation())}]};
		} catch (error) {
			return {
				isError: true,
				content: [
					{
						type: 'text',
						text: error instanceof ToolReadError ? error.message : new ToolReadError(500).message,
					},
				],
			};
		}
	};
	const today = () =>
		new Intl.DateTimeFormat('en-CA', {
			timeZone: 'Europe/Amsterdam',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
		}).format(now());
	server.registerTool(
		'list_recurring',
		{
			description:
				'Read recurring bills and income, monthly totals and unconverted counts. asOf defaults to today in Europe/Amsterdam.',
			inputSchema: z.strictObject({asOf: z.iso.date().optional()}),
			annotations,
		},
		async ({asOf}) => read(() => reader.listRecurring({asOf: asOf ?? today()})),
	);
	server.registerTool(
		'recurring_summary',
		{
			description:
				'Read recurring monthly totals, unconverted counts and the next three upcoming payments. asOf defaults to today in Europe/Amsterdam.',
			inputSchema: z.strictObject({asOf: z.iso.date().optional()}),
			annotations,
		},
		async ({asOf}) => read(() => reader.recurringSummary({asOf: asOf ?? today()})),
	);
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
		async ({month, asOf}) => read(() => reader.monthSummary({month, asOf: asOf ?? today()})),
	);
	for (const [name, operation] of [
		['cash_flow', 'cashFlow'],
		['balance_trend', 'balanceTrend'],
	] as const) {
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
				read(() => reader[operation]({interval, from, to, asOf: asOf ?? today()})),
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
						...BANK_TRANSACTION_CATEGORY_DEFINITIONS,
						{
							value: BANK_TRANSACTION_UNCATEGORIZED,
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
				sort: sortSchema.optional(),
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
		async ({filters, sort, page, pageSize}) =>
			read(() => reader.searchTransactions({filters, sort, page, pageSize})),
	);
	server.registerTool(
		'transaction_totals',
		{
			description:
				'Exact decimal-string spending, income and net across ALL matching transactions, plus count and excluded unknownDirection/missingBaseAmount counts. Uses Tempo base-currency and spending semantics, not a page sum.',
			inputSchema: z.strictObject({filters: filtersSchema.optional()}),
			annotations,
		},
		async ({filters}) => read(() => reader.transactionTotals({filters})),
	);
	server.registerTool(
		'get_transaction',
		{
			description: 'Get a single owner-scoped transaction by UUIDv4.',
			inputSchema: z.strictObject({id: z.uuidv4()}),
			annotations,
		},
		async ({id}) => read(() => reader.getTransaction(id)),
	);
	server.registerTool(
		'review_counts',
		{
			description: 'Read counts of transactions needing review or categorization.',
			inputSchema: z.strictObject({}),
			annotations,
		},
		async () => read(() => reader.reviewCounts()),
	);
	server.registerTool(
		'list_accounts',
		{
			description: 'List bank connections, accounts, balances, base currency and sync freshness.',
			inputSchema: z.strictObject({}),
			annotations,
		},
		async () => read(() => reader.listAccounts()),
	);
	return server;
}
