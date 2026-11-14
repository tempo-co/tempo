import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {Logger} from '@nestjs/common';
import {
	BANK_TRANSACTION_CATEGORY_DEFINITIONS,
	BANK_TRANSACTION_UNCATEGORIZED,
	BREAKDOWN_DIMENSIONS,
	BREAKDOWN_INTERVALS,
	type BankBalanceTrend,
	type BankConnection,
	type BankTransaction,
	type BankTransactionBreakdown,
	type BankTransactionBreakdownQuery,
	type BankTransactionCashFlow,
	type BankTransactionCashFlowQuery,
	type BankTransactionReviewCounts,
	type BankTransactionSummary,
	type BankTransactionSummaryQuery,
	type BankTransactionTotals,
	type BankTransactionsResponse,
	CASH_FLOW_INTERVALS,
	MAX_RANGE_PERIODS,
	MERCHANT_GROUP_ID_PATTERN,
	MERCHANT_LIST_MAX_LIMIT,
	MERCHANT_RANKING_MAX_LIMIT,
	MERCHANT_SEARCH_MAX_LENGTH,
	type MerchantGroup,
	type MerchantGroupPeriods,
	type MerchantGroupsQuery,
	type MerchantGroupsResponse,
	type MerchantRanking,
	type MerchantRankingQuery,
	type RecurringSeriesLists,
	type RecurringSeriesQuery,
	type RecurringSummary,
} from '@tempo/contracts';
import validator from 'validator';
import {z} from 'zod';

import {dateInTimeZone} from '@core/time/app-time-zone';

import {safeErrorStack} from '../bank-sync-failure';
import {ToolReadError} from './errors';
import {filtersSchema, sortSchema} from './inputs';

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
	spendingBreakdown(input: BankTransactionBreakdownQuery): Promise<BankTransactionBreakdown>;
	listMerchants(input: MerchantGroupsQuery): Promise<MerchantGroupsResponse>;
	merchantRanking(input: MerchantRankingQuery): Promise<MerchantRanking>;
	getMerchant(id: string): Promise<MerchantGroup>;
	merchantPeriods(id: string, input: PeriodInput): Promise<MerchantGroupPeriods>;
}

const logger = new Logger('McpTools');

const rangeLimits = (intervals: readonly (keyof typeof MAX_RANGE_PERIODS)[]) =>
	`API enforces range limits: ${intervals.map((interval) => `${interval} ${MAX_RANGE_PERIODS[interval]}`).join(', ')} periods; to must be on or before asOf.`;

/**
 * The tools for one owner; an omitted `asOf` is today in `timeZone`, the owner's IANA time zone, at each call.
 */
export function createToolServer(reader: ToolReader, timeZone: string, now: () => Date = () => new Date()): McpServer {
	const server = new McpServer(
		{name: 'tempo', version: '0.1.0'},
		{
			instructions:
				"Combined money figures are in the response's baseCurrency, the owner's reporting currency. When baseCurrency is null, Tempo has no reporting currency yet or is still converting amounts into a new one: do not present those figures as totals. Amounts with their own currency field are always in that currency.",
		},
	);
	const annotations = {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true};
	const read = async (operation: () => Promise<unknown>): Promise<CallToolResult> => {
		try {
			return {content: [{type: 'text', text: JSON.stringify(await operation())}]};
		} catch (error) {
			// Like REST's exception filter, log unexpected failures; name and stack frames only, never the message.
			if (!(error instanceof ToolReadError))
				logger.error(`MCP tool read failed unexpectedly: ${safeErrorStack(error)}`);
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
	const today = () => dateInTimeZone(now(), timeZone);
	const asOfDefault = `asOf defaults to today in the account's time zone (${timeZone}).`;
	server.registerTool(
		'list_recurring',
		{
			description: `Read recurring bills and income, monthly totals and unconverted counts. ${asOfDefault}`,
			inputSchema: z.strictObject({asOf: z.iso.date().optional()}),
			annotations,
		},
		async ({asOf}) => read(() => reader.listRecurring({asOf: asOf ?? today()})),
	);
	server.registerTool(
		'recurring_summary',
		{
			description: `Read recurring monthly totals, unconverted counts, the next three upcoming payments and late or higher-than-usual bills. ${asOfDefault}`,
			inputSchema: z.strictObject({asOf: z.iso.date().optional()}),
			annotations,
		},
		async ({asOf}) => read(() => reader.recurringSummary({asOf: asOf ?? today()})),
	);
	server.registerTool(
		'month_summary',
		{
			description: `Monthly spending and income with baseline comparisons. ${asOfDefault}`,
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
				description: `Read period analytics. ${asOfDefault} ${rangeLimits(CASH_FLOW_INTERVALS)}`,
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
		'spending_breakdown',
		{
			description: `Spending by category (by: category, net of refunds) or income by source (by: source) per month or year, each period's total equal to cash_flow's. ${asOfDefault} ${rangeLimits(BREAKDOWN_INTERVALS)}`,
			inputSchema: z.strictObject({
				interval: z.enum(BREAKDOWN_INTERVALS),
				by: z.enum(BREAKDOWN_DIMENSIONS),
				from: z.iso.date(),
				to: z.iso.date(),
				asOf: z.iso.date().optional(),
			}),
			annotations,
		},
		async ({interval, by, from, to, asOf}) =>
			read(() => reader.spendingBreakdown({interval, by, from, to, asOf: asOf ?? today()})),
	);
	server.registerTool(
		'list_merchants',
		{
			description:
				'List merchant groups (brands, or single merchants such as people) with all-time spent, received and count, most spent first; use it to find merchant ids by name.',
			inputSchema: z.strictObject({
				search: z
					.string()
					.refine(
						(value) => validator.isLength(value, {max: MERCHANT_SEARCH_MAX_LENGTH}),
						`Search must contain at most ${MERCHANT_SEARCH_MAX_LENGTH} characters.`,
					)
					.optional(),
				offset: z.int().min(0).optional(),
				limit: z.int().min(1).max(MERCHANT_LIST_MAX_LIMIT).optional(),
			}),
			annotations,
		},
		async ({search, offset, limit}) => read(() => reader.listMerchants({search, offset, limit})),
	);
	server.registerTool(
		'merchant_ranking',
		{
			description: `Top merchants by net spending in the week, month or year containing period, each against its usual amount in earlier periods, using Tempo's spending semantics. ${asOfDefault}`,
			inputSchema: z.strictObject({
				interval: z.enum(CASH_FLOW_INTERVALS),
				period: z.iso.date(),
				asOf: z.iso.date().optional(),
				limit: z.int().min(1).max(MERCHANT_RANKING_MAX_LIMIT).optional(),
			}),
			annotations,
		},
		async ({interval, period, asOf, limit}) =>
			read(() => reader.merchantRanking({interval, period, asOf: asOf ?? today(), limit})),
	);
	const merchantId = z.string().regex(new RegExp(MERCHANT_GROUP_ID_PATTERN));
	server.registerTool(
		'get_merchant',
		{
			description:
				"All-time totals of one merchant group (paid, refunded, average payment, first and last date, merchant variants) by an id from list_merchants, merchant_ranking or a transaction's merchantGroupId.",
			inputSchema: z.strictObject({id: merchantId}),
			annotations,
		},
		async ({id}) => read(() => reader.getMerchant(id)),
	);
	server.registerTool(
		'merchant_periods',
		{
			description: `How much was spent at and received from one merchant group per week, month or year, using Tempo's spending semantics; id comes from list_merchants, merchant_ranking or a transaction's merchantGroupId. ${asOfDefault} ${rangeLimits(CASH_FLOW_INTERVALS)}`,
			inputSchema: z.strictObject({
				id: merchantId,
				interval: z.enum(CASH_FLOW_INTERVALS),
				from: z.iso.date(),
				to: z.iso.date(),
				asOf: z.iso.date().optional(),
			}),
			annotations,
		},
		async ({id, interval, from, to, asOf}) =>
			read(() => reader.merchantPeriods(id, {interval, from, to, asOf: asOf ?? today()})),
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
