import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {fixture, json, TOKEN, ID} from './helpers.mjs';

test('review_counts reads owner-scoped review counts', async (t) => {
	const f = await fixture(t);
	const body = {needsReview: 3, uncategorized: 7};
	f.respond(body);
	assert.deepEqual(json(await f.client.callTool({name: 'review_counts', arguments: {}})), body);
	assert.equal(f.requests[0].url, '/api/bank-transactions/review-counts');
});

test('get_transaction reads one UUIDv4 transaction unchanged', async (t) => {
	const f = await fixture(t);
	const body = {id: ID, amount: '12.3400', amountInBaseCurrency: null, description: 'Synthetic fixture'};
	f.respond(body);
	assert.deepEqual(json(await f.client.callTool({name: 'get_transaction', arguments: {id: ID}})), body);
	assert.equal(f.requests[0].url, `/api/bank-transactions/${ID}`);
});

test('transaction_totals reads all filtered matches as exact decimal strings', async (t) => {
	const f = await fixture(t);
	const body = {
		baseCurrency: 'EUR',
		spending: '9007199254740993.01',
		income: '0.00',
		net: '-9007199254740993.01',
		count: 233,
		excluded: {unknownDirection: 2, missingBaseAmount: 3},
	};
	f.respond(body);
	assert.deepEqual(
		json(
			await f.client.callTool({
				name: 'transaction_totals',
				arguments: {filters: {categories: ['SHOPPING'], cashFlows: ['SPENDING']}},
			}),
		),
		body,
	);
	const url = new URL(f.requests[0].url, 'http://example.test');
	assert.equal(url.pathname, '/api/bank-transactions/totals');
	assert.deepEqual(
		[...url.searchParams],
		[
			['filter[categories][]', 'SHOPPING'],
			['filter[cashFlows][]', 'SPENDING'],
		],
	);
});

test('search_transactions maps bounded paging and all DTO filters to nested API query parameters', async (t) => {
	const f = await fixture(t);
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
	};
	const body = {transactions: [{id: ID, amount: '12.3400'}], total: 233};
	f.respond(body);
	assert.deepEqual(
		json(await f.client.callTool({name: 'search_transactions', arguments: {filters, page: 2, pageSize: 100}})),
		body,
	);
	const url = new URL(f.requests[0].url, 'http://example.test');
	assert.equal(url.pathname, '/api/bank-transactions');
	assert.deepEqual(Object.fromEntries(url.searchParams), {
		'pagination[pageIndex]': '2',
		'pagination[pageSize]': '100',
		'filter[bookingDate][from]': '2040-01-01',
		'filter[bookingDate][to]': '2040-02-01',
		'filter[bankAccountIds][]': ID,
		'filter[search]': 'Example € & Store',
		'filter[categories][]': 'UNCATEGORIZED',
		'filter[categorySources][]': 'MANUAL',
		'filter[financialEventTypes][]': 'OWN_TRANSFER',
		'filter[cashFlows][]': 'SPENDING',
		'filter[baseAmount]': 'PRESENT',
		'filter[categoryStatuses][]': 'CATEGORIZING',
	});
	assert.deepEqual(url.searchParams.getAll('filter[categories][]'), ['FOOD_AND_DRINK', 'UNCATEGORIZED']);
	await f.client.callTool({name: 'search_transactions', arguments: {}});
	const defaults = new URL(f.requests[1].url, 'http://example.test');
	assert.equal(defaults.searchParams.get('pagination[pageIndex]'), '0');
	assert.equal(defaults.searchParams.get('pagination[pageSize]'), '10');
	const tool = (await f.client.listTools()).tools.find((tool) => tool.name === 'search_transactions');
	assert.match(tool.description, /transaction_totals/);
});

test('list_categories uses the API category source with descriptions and an uncategorized filter', async (t) => {
	const f = await fixture(t);
	const source = await readFile(
		new URL('../../src/app/modules/banking/categorization/bank-transaction-category.ts', import.meta.url),
		'utf8',
	);
	const code = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ES2022}}).outputText;
	const api = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
	const categories = json(await f.client.callTool({name: 'list_categories', arguments: {}}));
	assert.deepEqual(categories, [
		...api.BANK_TRANSACTION_CATEGORY_DEFINITIONS,
		{value: 'UNCATEGORIZED', label: 'Uncategorized', description: 'Filter transactions without a category.'},
	]);
	assert.deepEqual(f.requests, []);
});

for (const [name, route] of [
	['cash_flow', 'cash-flow'],
	['balance_trend', 'balance-trend'],
]) {
	test(`${name} reads period analytics with the required asOf date`, async (t) => {
		const f = await fixture(t);
		const body = {baseCurrency: 'EUR', periods: [{net: '-123.01', complete: false}]};
		f.respond(body);
		assert.deepEqual(
			json(await f.client.callTool({name, arguments: {interval: 'month', from: '2040-01-01', to: '2040-02-01'}})),
			body,
		);
		assert.equal(
			f.requests[0].url,
			`/api/bank-transactions/${route}?interval=month&from=2040-01-01&to=2040-02-01&asOf=2040-02-03`,
		);
		await f.client.callTool({
			name,
			arguments: {interval: 'week', from: '2040-01-01', to: '2040-01-02', asOf: '2040-01-03'},
		});
		assert.equal(
			f.requests[1].url,
			`/api/bank-transactions/${route}?interval=week&from=2040-01-01&to=2040-01-02&asOf=2040-01-03`,
		);
	});
}

test('month_summary passes a month and Amsterdam calendar date to the summary route', async (t) => {
	const f = await fixture(t);
	const body = {baseCurrency: 'EUR', spending: '9999999999999999.01', income: '2.00'};
	f.respond(body);
	assert.deepEqual(json(await f.client.callTool({name: 'month_summary', arguments: {month: '2040-02'}})), body);
	assert.equal(f.requests[0].url, '/api/bank-transactions/summary?month=2040-02&asOf=2040-02-03');
	await f.client.callTool({name: 'month_summary', arguments: {month: '2040-02', asOf: '2040-02-29'}});
	assert.equal(f.requests[1].url, '/api/bank-transactions/summary?month=2040-02&asOf=2040-02-29');
});

test('list_accounts reads connections with decimal balances and sync freshness', async (t) => {
	const f = await fixture(t);
	const body = [
		{
			id: 'synthetic-connection',
			baseCurrency: 'EUR',
			lastSyncedAt: null,
			nextSyncAt: null,
			syncStatus: 'IDLE',
			bankAccounts: [{currentBalanceAmount: '9007199254740993.01', currency: 'EUR'}],
		},
	];
	f.respond(body);
	const tools = (await f.client.listTools()).tools;
	assert.ok(tools.some((tool) => tool.name === 'list_accounts'));
	assert.deepEqual(json(await f.client.callTool({name: 'list_accounts', arguments: {}})), body);
	assert.deepEqual(f.requests, [{method: 'GET', url: '/api/bank-connections', authorization: `Bearer ${TOKEN}`}]);
	assert.equal(tools.find((tool) => tool.name === 'list_accounts').annotations.readOnlyHint, true);
});
