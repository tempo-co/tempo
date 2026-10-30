import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {CallToolResultSchema} from '@modelcontextprotocol/sdk/types.js';
import {Logger} from '@nestjs/common';
import {Throttle, seconds} from '@nestjs/throttler';
import Redis from 'ioredis';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {AddressInfo, createConnection} from 'node:net';
import request from 'supertest';
import {DataSource} from 'typeorm';

import {ConfigurationService} from '@core/config/config.service';
import {PersonalAccessTokenService} from '@core/personal-access-token/personal-access-token.service';
import {TEST_THROTTLER_NAME} from '@core/rate-limit/rate-limit.module';
import {REDIS} from '@core/redis/redis.constants';
import {SessionService} from '@core/session/session.service';
import {Account} from '@modules/account/account.entity';
import {BankConnectionResponseDto} from '@modules/banking/api/dtos/bank-connection-response.dto';
import {BankTransactionsResponseDto} from '@modules/banking/api/dtos/bank-transaction-response.dto';
import {McpController} from '@modules/banking/api/mcp.controller';

import {BankingFixtures, bookedRow} from '../../../scripts/seed-data/banking-fixtures';
import {VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD} from '../../../scripts/seed-data/seed.constants';
import {getApp, getSessionCookie} from '../../setup/e2e.setup';
import {createVerifiedAccount} from '../../utils/auth-utils';

const ORIGIN = 'http://localhost:5173';
const INITIALIZE = {
	jsonrpc: '2.0',
	id: 1,
	method: 'initialize',
	params: {protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {name: 'example-client', version: '1'}},
};
const METHODS = ['post', 'get', 'delete', 'head'] as const;
const TOOL_NAMES = [
	'balance_trend',
	'cash_flow',
	'get_transaction',
	'list_accounts',
	'list_categories',
	'list_recurring',
	'month_summary',
	'recurring_summary',
	'review_counts',
	'search_transactions',
	'transaction_totals',
];

describe('Hosted MCP', () => {
	let url: URL;
	let owner: Account;
	let token: string;
	let tokenId: string;
	let cookie: string;
	let staleCookie: string;
	let otherOwner: Account;
	let fixtures: BankingFixtures;

	beforeAll(async () => {
		const app = getApp();
		await app.listen(0, '127.0.0.1');
		url = new URL(`http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/mcp`);
		const accounts = app.get(DataSource).getRepository(Account);
		const created = await createVerifiedAccount(
			app.getHttpServer(),
			app.get(ConfigurationService).get('EMAIL_UI_URL'),
		);
		await accounts.update(created.id, {baseCurrency: 'EUR'});
		owner = await accounts.findOneByOrFail({id: created.id});
		otherOwner = await accounts.findOneByOrFail({email: VERIFIED_ACCOUNT_EMAIL});
		const createdToken = await app.get(PersonalAccessTokenService).create(owner.id, 'Example MCP client', 30);
		token = createdToken.token;
		tokenId = createdToken.id;
		fixtures = new BankingFixtures(app);
		const login = () =>
			request(app.getHttpServer())
				.post('/auth/login')
				.send({email: VERIFIED_ACCOUNT_EMAIL, password: VERIFIED_ACCOUNT_PASSWORD})
				.expect(200);
		cookie = getSessionCookie(await login())!.split(';')[0];
		staleCookie = getSessionCookie(await login())!.split(';')[0];
		const sid = decodeURIComponent(staleCookie.split('=')[1]).slice(2).split('.')[0];
		await app.get<Redis>(REDIS).del(`${app.get(ConfigurationService).get('SESSION_REDIS_KEY')}:${sid}`);
	});

	function http(method: (typeof METHODS)[number], path = '/mcp') {
		return request(getApp().getHttpServer())[method](path).set('Accept', 'application/json, text/event-stream');
	}

	function raw(method: string, path: string, headers: Record<string, string>, body = '') {
		return new Promise<{status: number; headers: Record<string, string>}>((resolve, reject) => {
			const socket = createConnection({host: url.hostname, port: Number(url.port)});
			const chunks: Buffer[] = [];
			socket.setTimeout(5000, () => socket.destroy(new Error('Synthetic HTTP request timed out')));
			socket.on('error', reject);
			socket.on('data', (chunk: Buffer) => {
				chunks.push(chunk);
				const response = Buffer.concat(chunks).toString('latin1');
				if (!response.includes('\r\n\r\n')) return;
				const [statusLine, ...lines] = response.split('\r\n\r\n')[0].split('\r\n');
				resolve({
					status: Number(statusLine.split(' ')[1]),
					headers: Object.fromEntries(
						lines.map((line) => {
							const colon = line.indexOf(':');
							return [line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()];
						}),
					),
				});
				socket.destroy();
			});
			socket.on('connect', () => {
				const head = [
					`${method} ${path} HTTP/1.1`,
					`Host: ${url.host}`,
					'Connection: close',
					`Content-Length: ${Buffer.byteLength(body)}`,
					...Object.entries(headers).map(([key, value]) => `${key}: ${value}`),
					'',
					'',
				].join('\r\n');
				// Node's HTTP client may re-encode non-ASCII headers; send exact HTTP/1.1 header bytes.
				socket.write(Buffer.concat([Buffer.from(head, 'latin1'), Buffer.from(body)]));
			});
		});
	}

	it('loads shared tools through the root CommonJS TypeScript runtime', () => {
		execFileSync(
			process.execPath,
			[
				'-r',
				'ts-node/register',
				'-e',
				"if (typeof require('./mcp/src/tools.ts').createToolServer !== 'function') process.exit(1)",
			],
			{cwd: process.cwd(), stdio: 'pipe'},
		);
	}, 15_000);

	/** Observe actual Redis commands: unchanged contents alone cannot prove that sessions weren't read. */
	async function isolated(operation: () => Promise<void>) {
		const app = getApp();
		const redis = app.get<Redis>(REDIS);
		const prefix = `${app.get(ConfigurationService).get('SESSION_REDIS_KEY')}:`;
		const snapshot = async () => {
			const keys = (await redis.keys(`${prefix}*`)).sort();
			return Promise.all(
				keys.map(async (key) => ({
					key,
					value: await redis.get(key),
					expires: await redis.call('PEXPIRETIME', key),
				})),
			);
		};
		const before = await snapshot();
		const monitor = await redis.monitor();
		const sessionCommands: string[] = [];
		monitor.on('monitor', (_time: string, args: string[]) => {
			if (args.some((arg) => arg.startsWith(prefix))) sessionCommands.push(args[0]);
		});
		const lastSeen = jest.spyOn(app.get(SessionService), 'updateLastSeen');
		try {
			await operation();
			await redis.ping();
			await new Promise((resolve) => setTimeout(resolve, 20));
			expect(sessionCommands).toEqual([]);
			expect(lastSeen).not.toHaveBeenCalled();
		} finally {
			monitor.disconnect();
			lastSeen.mockRestore();
		}
		expect(await snapshot()).toEqual(before);
	}

	it('initializes a stateless SDK client and reads every tool from only its token owner', async () => {
		const connection = await fixtures.createConnection(owner, {
			aspspName: 'Example Bank',
			providerSessionId: 'example-private-session',
			authorizationStateHash: 'a'.repeat(64),
		});
		const bankAccount = await fixtures.createBankAccount(connection, {
			currentBalanceAmount: '123.45',
			currentBalanceType: 'AVAILABLE',
			balanceUpdatedAt: new Date('2026-01-31T12:00:00Z'),
			iban: 'NL91ABNA0417164300',
		});
		const rows = await fixtures.createTransactions(
			bankAccount,
			Array.from({length: 6}, (_, index) =>
				bookedRow(`2026-01-0${index + 1}`, '-1.25', {
					description: 'Example Shop',
					providerTransactionId: 'example-private-transaction',
					counterpartyIban: 'NL91ABNA0417164300',
				}),
			),
		);
		await fixtures.createTransaction(bankAccount, bookedRow('2026-01-07', '20.00', {category: 'SALARY'}));
		await fixtures.createTransaction(
			bankAccount,
			bookedRow('2026-01-08', '-2.00', {
				category: null,
				categoryStatus: 'FAILED',
				amountInBaseCurrency: null,
				categoryLastError: 'example-private-error',
			}),
		);
		const otherConnection = await fixtures.createConnection(otherOwner, {aspspName: 'Example Other Bank'});
		const otherBankAccount = await fixtures.createBankAccount(otherConnection, {currentBalanceAmount: '999999.00'});
		const otherRow = await fixtures.createTransaction(
			otherBankAccount,
			bookedRow('2026-01-04', '-9999.00', {category: 'NEEDS_REVIEW'}),
		);
		const recurringFixtures = [
			{name: 'Example Subscription Alpha', day: '03', amount: '-9.99', category: 'SUBSCRIPTIONS'},
			{name: 'Example Subscription Beta', day: '08', amount: '-12.50', category: 'SUBSCRIPTIONS'},
			{name: 'Example Subscription Gamma', day: '12', amount: '-25.01', category: 'SUBSCRIPTIONS'},
			{name: 'Example Payroll', day: '20', amount: '1200.00', category: 'SALARY'},
		] as const;
		for (const {name, day, amount, category} of recurringFixtures)
			await fixtures.createTransactions(
				bankAccount,
				['07', '08', '09', '10', '11', '12'].map((month) =>
					bookedRow(`2025-${month}-${day}`, amount, {description: name, counterpartyName: name, category}),
				),
			);
		await fixtures.createTransactions(
			otherBankAccount,
			['07', '08', '09', '10', '11', '12'].map((month) =>
				bookedRow(`2025-${month}-05`, '-777.00', {
					description: 'Example Other Subscription',
					counterpartyName: 'Example Other Subscription',
					category: 'SUBSCRIPTIONS',
				}),
			),
		);
		const savedRows = await fixtures.transactions.find({
			where: {bankAccountId: bankAccount.id},
			order: {id: 'ASC'},
		});
		const otherRecurring = (
			await request(getApp().getHttpServer())
				.get('/recurring-series?asOf=2025-12-31')
				.set('Cookie', cookie)
				.expect(200)
		).body;
		const foreignKey = otherRecurring.expenses.series.find(
			({name}: {name: string}) => name === 'Example Other Subscription',
		).key;
		const statuses: number[] = [];
		const client = new Client({name: 'example-hosted-client', version: '1'});
		const call = async (name: string, args: Record<string, unknown> = {}) => {
			const result = CallToolResultSchema.parse(await client.callTool({name, arguments: args}));
			expect(result.isError).not.toBe(true);
			expect(result.content).toHaveLength(1);
			const content = result.content[0];
			if (content.type !== 'text') throw new Error('Expected tool JSON text');
			return JSON.parse(content.text);
		};
		const rest = async (path: string) =>
			(await request(getApp().getHttpServer()).get(path).auth(token, {type: 'bearer'}).expect(200)).body;
		try {
			await isolated(async () => {
				await client.connect(
					new StreamableHTTPClientTransport(url, {
						requestInit: {headers: {Authorization: `Bearer ${token}`, Cookie: cookie, Origin: ORIGIN}},
						fetch: async (input, init) => {
							const response = await fetch(input, init);
							expect(response.headers.get('set-cookie')).toBeNull();
							expect(response.headers.get('mcp-session-id')).toBeNull();
							statuses.push(response.status);
							return response;
						},
					}),
				);
				const {tools} = await client.listTools();
				expect(tools.map(({name}) => name).sort()).toEqual(TOOL_NAMES);
				const [usedByMcp] = await getApp()
					.get(DataSource)
					.query('SELECT "lastUsedAt" FROM personal_access_tokens WHERE id = $1', [tokenId]);
				expect(usedByMcp.lastUsedAt).toBeInstanceOf(Date);
				for (const tool of tools)
					expect(tool.annotations).toMatchObject({
						readOnlyHint: true,
						destructiveHint: false,
						idempotentHint: true,
						openWorldHint: true,
					});
				const accounts: BankConnectionResponseDto[] = await call('list_accounts');
				expect(accounts).toEqual(await rest('/bank-connections'));
				expect(accounts.map(({id}) => id)).toEqual([connection.id]);
				expect(accounts[0].bankAccounts.map(({id}) => id)).toEqual([bankAccount.id]);
				expect(accounts[0].bankAccounts[0].currentBalanceAmount).toBe(
					(await fixtures.bankAccounts.findOneByOrFail({id: bankAccount.id})).currentBalanceAmount,
				);
				const filters = {
					bookingDate: {from: '2026-01-01', to: '2026-01-31'},
					bankAccountIds: [bankAccount.id, otherBankAccount.id],
					categories: ['SHOPPING'],
					search: 'Example Shop',
				};
				const search: BankTransactionsResponseDto = await call('search_transactions', {filters, pageSize: 5});
				expect(search.total).toBe(6);
				expect(search.transactions).toHaveLength(5);
				expect(search.transactions.every(({id}) => rows.some((row) => row.id === id))).toBe(true);
				expect(await call('transaction_totals', {filters})).toEqual({
					baseCurrency: 'EUR',
					count: 6,
					spending: '7.50',
					income: '0.00',
					net: '-7.50',
					excluded: {unknownDirection: 0, missingBaseAmount: 0},
				});
				expect(await call('search_transactions', {filters: {bankAccountIds: [otherBankAccount.id]}})).toEqual({
					transactions: [],
					total: 0,
				});
				expect(
					await call('transaction_totals', {filters: {bankAccountIds: [otherBankAccount.id]}}),
				).toMatchObject({count: 0, spending: '0.00', income: '0.00'});
				const detail = await call('get_transaction', {id: rows[0].id});
				expect(detail).toEqual(await rest(`/bank-transactions/${rows[0].id}`));
				expect(detail).toMatchObject({
					id: rows[0].id,
					amount: (await fixtures.transactions.findOneByOrFail({id: rows[0].id})).amount,
					amountInBaseCurrency: '-1.25',
				});
				const summary = await call('month_summary', {month: '2026-01', asOf: '2026-02-01'});
				expect(summary).toEqual(await rest('/bank-transactions/summary?month=2026-01&asOf=2026-02-01'));
				expect(summary.totals).toMatchObject({spending: '7.50', income: '20.00', net: '12.50'});
				const period = {interval: 'month', from: '2026-01-01', to: '2026-01-31', asOf: '2026-02-01'};
				const flow = await call('cash_flow', period);
				expect(flow).toEqual(await rest(`/bank-transactions/cash-flow?${new URLSearchParams(period)}`));
				expect(flow.periods[0]).toMatchObject({spending: '7.50', income: '20.00', net: '12.50'});
				const trend = await call('balance_trend', period);
				expect(trend).toEqual(await rest(`/bank-transactions/balance-trend?${new URLSearchParams(period)}`));
				expect(trend.periods[0].accounts.map(({id}: {id: string}) => id)).toEqual([bankAccount.id]);
				expect(await call('review_counts')).toEqual({
					needsReview: 0,
					categorizationFailed: 1,
					categorizing: 0,
					unknownDirection: 0,
					missingBaseAmount: 1,
				});
				expect(await call('list_categories')).toEqual(
					expect.arrayContaining([
						expect.objectContaining({value: 'SHOPPING'}),
						expect.objectContaining({value: 'UNCATEGORIZED'}),
					]),
				);
				const recurring = await call('list_recurring', {asOf: '2025-12-31'});
				expect(recurring).toEqual(await rest('/recurring-series?asOf=2025-12-31'));
				expect(recurring.expenses.series.map(({name}: {name: string}) => name).sort()).toEqual([
					'Example Subscription Alpha',
					'Example Subscription Beta',
					'Example Subscription Gamma',
				]);
				expect(recurring.expenses).toMatchObject({
					monthlyTotal: '47.50',
					unconvertedCount: 0,
					baseCurrency: 'EUR',
				});
				expect(recurring.income).toMatchObject({
					series: [expect.objectContaining({name: 'Example Payroll', typicalAmount: '1200.00'})],
					monthlyTotal: '1200.00',
					unconvertedCount: 0,
					baseCurrency: 'EUR',
				});
				const recurringSummary = await call('recurring_summary', {asOf: '2025-12-31'});
				expect(recurringSummary).toEqual(await rest('/recurring-series/summary?asOf=2025-12-31'));
				expect(recurringSummary).toEqual({
					expenseMonthlyTotal: '47.50',
					incomeMonthlyTotal: '1200.00',
					expenseThisMonth: recurring.expenses.thisMonth,
					incomeThisMonth: recurring.income.thisMonth,
					expenseUnconvertedCount: 0,
					incomeUnconvertedCount: 0,
					baseCurrency: 'EUR',
					upcoming: recurring.expenses.series
						.toSorted((a: {nextExpectedDate: string}, b: {nextExpectedDate: string}) =>
							a.nextExpectedDate.localeCompare(b.nextExpectedDate),
						)
						.map(
							({
								key,
								name,
								direction,
								nextExpectedDate,
								typicalAmount,
								amountKind,
								currency,
								category,
								merchantLogoUrl,
								flags,
							}: Record<string, unknown>) => ({
								key,
								name,
								direction,
								nextExpectedDate,
								typicalAmount,
								amountKind,
								currency,
								category,
								merchantLogoUrl,
								flags,
							}),
						),
				});
				expect([...recurring.expenses.series, ...recurring.income.series]).toHaveLength(4);
				expect(recurringSummary.upcoming).toHaveLength(3);
				const recurringSeriesKey = recurring.expenses.series.find(
					({name}: {name: string}) => name === 'Example Subscription Alpha',
				).key;
				const seriesFilters = {recurringSeriesKey, bankAccountIds: [bankAccount.id, otherBankAccount.id]};
				const seriesSearch = await call('search_transactions', {filters: seriesFilters, pageSize: 5});
				const seriesQuery = new URLSearchParams({
					'filter[recurringSeriesKey]': recurringSeriesKey,
					'filter[bankAccountIds][]': bankAccount.id,
					'pagination[pageSize]': '5',
				});
				seriesQuery.append('filter[bankAccountIds][]', otherBankAccount.id);
				expect(seriesSearch).toEqual(await rest(`/bank-transactions?${seriesQuery}`));
				expect(seriesSearch.total).toBe(6);
				expect(seriesSearch.transactions).toHaveLength(5);
				expect(
					seriesSearch.transactions.every(
						({description}: {description: string}) => description === 'Example Subscription Alpha',
					),
				).toBe(true);
				const seriesTotals = await call('transaction_totals', {filters: seriesFilters});
				seriesQuery.delete('pagination[pageSize]');
				expect(seriesTotals).toEqual(await rest(`/bank-transactions/totals?${seriesQuery}`));
				expect(seriesTotals).toEqual({
					baseCurrency: 'EUR',
					spending: '59.94',
					income: '0.00',
					net: '-59.94',
					count: 6,
					excluded: {unknownDirection: 0, missingBaseAmount: 0},
				});
				const narrowed = {...seriesFilters, bookingDate: {from: '2025-10-01'}};
				expect(await call('search_transactions', {filters: narrowed})).toMatchObject({total: 3});
				expect(await call('transaction_totals', {filters: narrowed})).toMatchObject({
					count: 3,
					spending: '29.97',
					net: '-29.97',
				});

				for (const name of ['search_transactions', 'transaction_totals']) {
					const foreign = await client.callTool({
						name,
						arguments: {filters: {recurringSeriesKey: foreignKey}},
					});
					const missing = await client.callTool({
						name,
						arguments: {filters: {recurringSeriesKey: 'f'.repeat(32)}},
					});
					expect(foreign).toEqual(missing);
					expect(foreign).toMatchObject({
						isError: true,
						content: [
							{
								type: 'text',
								text: 'Tempo API HTTP 404: Resource not found or not accessible to this token.',
							},
						],
					});
				}
				const alternateBank = await fixtures.createBankAccount(
					await fixtures.createConnection(owner, {aspspName: 'Example Alternate Bank'}),
				);
				const alternateRow = await fixtures.createTransaction(
					alternateBank,
					bookedRow('2026-01-09', '-3.33', {category: 'FOOD_AND_DRINK'}),
				);
				const ownedRowIds = new Set([...savedRows.map(({id}) => id), alternateRow.id]);
				for (const by of ['bookingDate', 'amount', 'category', 'source']) {
					for (const order of ['ASC', 'DESC']) {
						const sortFilters = {bankAccountIds: [bankAccount.id, alternateBank.id, otherBankAccount.id]};
						const sortQuery = new URLSearchParams({
							'sort[by]': by,
							'sort[order]': order,
							'pagination[pageIndex]': '1',
							'pagination[pageSize]': '5',
						});
						for (const id of sortFilters.bankAccountIds) sortQuery.append('filter[bankAccountIds][]', id);
						const sorted = await call('search_transactions', {
							filters: sortFilters,
							sort: {by, order},
							page: 1,
							pageSize: 5,
						});
						expect(sorted).toEqual(await rest(`/bank-transactions?${sortQuery}`));
						expect(sorted.transactions).toHaveLength(5);
						expect(sorted.transactions.every(({id}: {id: string}) => ownedRowIds.has(id))).toBe(true);
					}
				}
				const publicOutput = JSON.stringify({
					accounts,
					search,
					detail,
					summary,
					flow,
					trend,
					recurring,
					recurringSummary,
				});
				for (const privateValue of [
					'providerSessionId',
					'authorizationStateHash',
					'identificationHash',
					'providerAccountId',
					'counterpartyIban',
					'dedupeKey',
					'categoryLastError',
					'example-private',
					'NL91ABNA0417164300',
					otherOwner.id,
					otherRow.id,
					otherBankAccount.id,
					'Example Other Subscription',
				])
					expect(publicOutput).not.toContain(privateValue);
				const forbidden = await client.callTool({name: 'get_transaction', arguments: {id: otherRow.id}});
				const missing = await client.callTool({name: 'get_transaction', arguments: {id: randomUUID()}});
				expect(forbidden).toEqual(missing);
				expect(forbidden).toMatchObject({
					isError: true,
					content: [
						{type: 'text', text: 'Tempo API HTTP 404: Resource not found or not accessible to this token.'},
					],
				});
				const invalidPeriod = await client.callTool({
					name: 'cash_flow',
					arguments: {...period, from: '2026-02-01'},
				});
				expect(invalidPeriod).toMatchObject({
					isError: true,
					content: [{type: 'text', text: 'Tempo API HTTP 400: Request refused. Check tool input.'}],
				});
				const strict = await client.callTool({name: 'list_accounts', arguments: {accountId: otherOwner.id}});
				expect(strict.isError).toBe(true);
			});
			expect(statuses).toContain(200);
			expect(statuses).toContain(202);
			expect(
				await fixtures.transactions.find({where: {bankAccountId: bankAccount.id}, order: {id: 'ASC'}}),
			).toEqual(savedRows);
			const [used] = await getApp()
				.get(DataSource)
				.query('SELECT "lastUsedAt" FROM personal_access_tokens WHERE id = $1', [tokenId]);
			expect(used.lastUsedAt).toBeInstanceOf(Date);
		} finally {
			await client.close();
		}
	});

	it.each(METHODS)('%s accepts only the configured Origin or an absent Origin', async (method) => {
		await isolated(async () => {
			for (const origin of [
				undefined,
				ORIGIN,
				'null',
				'invalid',
				'https://untrusted.example.test',
				`${ORIGIN}/`,
				`${ORIGIN}.example.test`,
			]) {
				const req = http(method).auth(token, {type: 'bearer'}).set('Cookie', cookie);
				if (origin !== undefined) req.set('Origin', origin);
				const response = await (method === 'post' ? req.send(INITIALIZE) : req).expect(
					origin === undefined || origin === ORIGIN ? (method === 'post' ? 200 : 405) : 403,
				);
				expect(response.headers['set-cookie']).toBeUndefined();
				if (response.status === 405) expect(response.headers.allow).toBe('POST');
			}
		});
	});

	it('refuses unexpected Origins on absolute-form request targets', async () => {
		await isolated(async () => {
			const response = await raw('OPTIONS', 'http://example.test/mcp', {Origin: 'null', Cookie: cookie});
			expect(response.status).toBe(403);
			expect(response.headers['set-cookie']).toBeUndefined();
		});
	});

	it('refuses cookie-only absolute-form requests without reading sessions', async () => {
		await isolated(async () => {
			const response = await raw(
				'POST',
				'http://example.test/mcp',
				{
					'Content-Type': 'application/json',
					Accept: 'application/json, text/event-stream',
					Cookie: cookie,
				},
				JSON.stringify(INITIALIZE),
			);
			expect(response.status).toBe(401);
			expect(response.headers['www-authenticate']).toBe('Bearer');
			expect(response.headers['set-cookie']).toBeUndefined();
		});
	});

	it.each(['/mcp', '/mcp/', '/MCP', '/McP/?example=1'])(
		'%s refuses cookie-only and malformed credentials without reading sessions',
		async (path) => {
			await isolated(async () => {
				for (const sessionCookie of [cookie, staleCookie]) {
					for (const authorization of [
						undefined,
						'Basic example',
						'Bearer tempo_pat_invalid',
						'Bearer',
						`Bearer ${token} extra`,
					]) {
						const req = http('post', path).set('Cookie', sessionCookie).send(INITIALIZE);
						if (authorization) req.set('Authorization', authorization);
						const response = await req.expect(401);
						expect(response.headers['www-authenticate']).toBe('Bearer');
						expect(response.headers['set-cookie']).toBeUndefined();
					}
				}
			});
		},
	);

	it.each(['options', 'patch', 'put'] as const)(
		'%s refuses an unexpected Origin before CORS or routing',
		async (method) => {
			await isolated(async () => {
				const response = await request(getApp().getHttpServer())
					[method]('/mcp')
					.set('Origin', 'null')
					.set('Cookie', cookie)
					.expect(403);
				expect(response.headers['set-cookie']).toBeUndefined();
			});
		},
	);

	it.each(['expired', 'revoked'] as const)(
		'refuses an %s token on every method without reading the supplied session',
		async (state) => {
			const app = getApp();
			const tokens = app.get(PersonalAccessTokenService);
			const created = await tokens.create(owner.id, 'Example refused client', 30);
			if (state === 'revoked') await tokens.revoke(owner.id, created.id);
			else
				await app
					.get(DataSource)
					.query(
						'UPDATE personal_access_tokens SET "expiresAt" = CURRENT_TIMESTAMP - INTERVAL \'1 second\' WHERE id = $1',
						[created.id],
					);
			await isolated(async () => {
				for (const method of METHODS) {
					const req = http(method).auth(created.token, {type: 'bearer'}).set('Cookie', cookie);
					const response = await (method === 'post' ? req.send(INITIALIZE) : req).expect(401);
					expect(response.headers['www-authenticate']).toBe('Bearer');
					expect(response.headers['set-cookie']).toBeUndefined();
				}
			});
		},
	);

	it('caps JSON request bodies at 100 KiB without reading sessions', async () => {
		const message = (size: number) => ({
			...INITIALIZE,
			params: {...INITIALIZE.params, clientInfo: {...INITIALIZE.params.clientInfo, name: 'x'.repeat(size)}},
		});
		await isolated(async () => {
			const response = await http('post')
				.auth(token, {type: 'bearer'})
				.set('Cookie', cookie)
				.send(message(100 * 1024))
				.expect(413);
			expect(response.headers['set-cookie']).toBeUndefined();
			const accepted = await http('post')
				.auth(token, {type: 'bearer'})
				.set('Cookie', staleCookie)
				.send(message(99 * 1024))
				.expect(200);
			expect(accepted.headers['set-cookie']).toBeUndefined();
			const fallback = await raw(
				'POST',
				'/mcp/',
				{
					'Content-Type': 'application/json\u00a0',
					Accept: 'application/json, text/event-stream',
					Authorization: `Bearer ${token}`,
					Cookie: cookie,
				},
				JSON.stringify({jsonrpc: '2.0', id: 2, method: 'tools/list'}) + ' '.repeat(110 * 1024),
			);
			expect(fallback.status).toBe(413);
			expect(fallback.headers['set-cookie']).toBeUndefined();
		});
	});

	it.each([
		{
			kind: 'parser',
			body: '{"example":"example-private-body",invalid}',
			expected: {statusCode: 400, message: 'Bad Request'},
		},
		{
			kind: 'protocol',
			body: {...INITIALIZE, id: {example: 'example-private-id'}},
			expected: {
				jsonrpc: '2.0',
				error: {code: -32700, message: 'Parse error: Invalid JSON-RPC message'},
				id: null,
			},
		},
	])('returns a safe $kind error without logging request content or reading sessions', async ({body, expected}) => {
		const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
		try {
			await isolated(async () => {
				const response = await http('post')
					.auth(token, {type: 'bearer'})
					.set('Cookie', cookie)
					.set('Content-Type', 'application/json')
					.send(body)
					.expect(400);
				expect(response.body).toEqual(expected);
				expect(response.headers['set-cookie']).toBeUndefined();
				expect(log).not.toHaveBeenCalled();
			});
		} finally {
			log.mockRestore();
		}
	});

	it('throttles MCP requests through the global guard without reading sessions', async () => {
		const descriptor = Object.getOwnPropertyDescriptor(McpController.prototype, 'post')!;
		Throttle({[TEST_THROTTLER_NAME]: {limit: 3, ttl: seconds(30), getTracker: () => 'example-mcp-throttle'}})(
			McpController.prototype,
			'post',
			descriptor,
		);
		await isolated(async () => {
			for (let index = 0; index < 3; index++)
				await http('post').auth(token, {type: 'bearer'}).set('Cookie', cookie).send(INITIALIZE).expect(200);
			const response = await http('post')
				.auth(token, {type: 'bearer'})
				.set('Cookie', staleCookie)
				.send(INITIALIZE)
				.expect(429);
			expect(Number(response.headers['retry-after-test'])).toBeGreaterThan(0);
			expect(response.headers['set-cookie']).toBeUndefined();
		});
	});
});
