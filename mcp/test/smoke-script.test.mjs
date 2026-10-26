import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {fixture, ID, TOKEN} from './helpers.mjs';

test('the disposable API smoke command exercises every tool through SDK stdio without printing data', async (t) => {
	const f = await fixture(t);
	f.respondWith((path) => {
		const route = new URL(path, 'http://example.test').pathname;
		const body = route.endsWith('/bank-connections')
			? []
			: route.endsWith('/totals')
				? {
						baseCurrency: 'EUR',
						spending: '1.00',
						income: '0.00',
						net: '-1.00',
						count: 1,
						excluded: {unknownDirection: 0, missingBaseAmount: 0},
					}
				: route.endsWith('/bank-transactions')
					? {transactions: [{id: ID, amount: '1.00'}], total: 1}
					: route.endsWith(`/${ID}`)
						? {id: ID, amount: '1.00'}
						: {synthetic: true};
		return {status: 200, headers: {}, body};
	});
	const {stdout, stderr} = await promisify(execFile)(
		process.execPath,
		[fileURLToPath(new URL('../scripts/smoke-api.mjs', import.meta.url))],
		{
			env: {...process.env, TEMPO_API_URL: f.apiUrl, TEMPO_API_TOKEN: TOKEN, TEMPO_SMOKE_TRANSACTION_ID: ID},
			timeout: 10000,
		},
	);
	assert.equal(stderr, '');
	assert.match(stdout, /PASS 11 tools/);
	assert.match(stdout, /PASS list_recurring/);
	assert.match(stdout, /PASS recurring_summary/);
	assert.doesNotMatch(stdout, /synthetic-test-token|1\.00|baseCurrency/);
	assert.equal(f.requests.length, 10);
	for (const req of f.requests) assert.equal(req.method, 'GET');
});
