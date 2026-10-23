import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fixture, ID, json} from './helpers.mjs';
import {filtersSchema} from '../dist/inputs.js';

const cases = [
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
	['search_transactions', {page: -1}, 'nonnegative page'],
	['search_transactions', {page: 1.5}, 'integer page'],
	['search_transactions', {page: '1'}, 'numeric page'],
	['search_transactions', {pageSize: 101}, 'page maximum'],
	['search_transactions', {pageSize: 25}, 'DTO page-size enum'],
	['search_transactions', {pageSize: 0}, 'page minimum'],
	['search_transactions', {filters: {search: '€'.repeat(1001)}}, 'search length'],
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

test('invalid DTO-shaped tool inputs are refused before HTTP', async (t) => {
	const f = await fixture(t);
	for (const [name, args, label] of cases) {
		const result = await f.client.callTool({name, arguments: args});
		assert.equal(result.isError, true, `${name}: ${label}`);
	}
	assert.deepEqual(f.requests, []);
});

test('all nine tools reject caller-supplied owner, token and origin overrides', async (t) => {
	const f = await fixture(t);
	const valid = {
		month_summary: {month: '2040-01'},
		cash_flow: {interval: 'month', from: '2040-01-01', to: '2040-01-02'},
		balance_trend: {interval: 'month', from: '2040-01-01', to: '2040-01-02'},
		get_transaction: {id: ID},
	};
	for (const {name} of (await f.client.listTools()).tools) {
		for (const [key, value] of [
			['accountId', ID],
			['token', 'synthetic-caller-token'],
			['origin', 'https://example.test'],
		]) {
			const result = await f.client.callTool({name, arguments: {...valid[name], [key]: value}});
			assert.equal(result.isError, true, `${name}: ${key}`);
		}
	}
	assert.deepEqual(f.requests, []);
});

test('DTO boundary values are accepted and forwarded unchanged', async (t) => {
	assert.equal(filtersSchema.safeParse({search: '❤️'.repeat(1000)}).success, true);
	assert.equal(filtersSchema.safeParse({search: '❤️'.repeat(1001)}).success, false);
	const f = await fixture(t);
	f.respond({transactions: [], total: 0});
	for (const pageSize of [5, 10, 20, 30, 40, 50, 100]) {
		json(
			await f.client.callTool({
				name: 'search_transactions',
				arguments: {pageSize, filters: {search: '€'.repeat(1000)}},
			}),
		);
	}
	assert.equal(f.requests.length, 7);
	for (const request of f.requests)
		assert.equal(new URL(request.url, 'http://example.test').searchParams.get('filter[search]'), '€'.repeat(1000));
	json(await f.client.callTool({name: 'search_transactions', arguments: {filters: {search: '😀'.repeat(1000)}}}));
	const unicodeRequest = f.requests.at(-1);
	assert.equal(
		new URL(unicodeRequest.url, 'http://example.test').searchParams.get('filter[search]'),
		'😀'.repeat(1000),
	);
	const beforeRejected = f.requests.length;
	const rejected = await f.client.callTool({
		name: 'search_transactions',
		arguments: {filters: {search: '😀'.repeat(1001)}},
	});
	assert.equal(rejected.isError, true);
	assert.equal(f.requests.length, beforeRejected);
	for (const month of ['1900-01', '2099-12'])
		json(await f.client.callTool({name: 'month_summary', arguments: {month, asOf: '2099-12-31'}}));
});
