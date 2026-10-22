import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fixture, TOKEN} from './helpers.mjs';

for (const status of [301, 302, 307, 308]) {
	test(`HTTP ${status} redirects are refused before another request`, async (t) => {
		const origin = await fixture(t);
		const target = await fixture(t);
		origin.respond({}, status, {Location: `${target.apiUrl}/sensitive-target`});
		const result = await origin.client.callTool({name: 'list_accounts', arguments: {}});
		assert.equal(result.isError, true);
		assert.match(result.content[0].text, /redirect.*refused/i);
		assert.equal(origin.requests.length, 1);
		assert.deepEqual(target.requests, []);
	});
}

test('same-origin redirects cannot forward the bearer to another path', async (t) => {
	const f = await fixture(t);
	f.respond({}, 302, {Location: '/private-target'});
	const result = await f.client.callTool({name: 'list_accounts', arguments: {}});
	assert.equal(result.isError, true);
	assert.match(result.content[0].text, /redirect.*refused/i);
	assert.equal(f.requests.length, 1);
});

for (const [status, expected] of [
	[400, /400.*input/i],
	[401, /401.*token/i],
	[403, /403.*permission/i],
	[404, /404.*not found/i],
	[429, /429.*Retry-After: 17/i],
	[500, /500.*unavailable/i],
	[503, /503.*unavailable/i],
]) {
	test(`HTTP ${status} becomes a safe actionable tool error`, async (t) => {
		const f = await fixture(t);
		f.respond({message: `upstream-sensitive-payload ${TOKEN}`}, status, {'Retry-After': '17'});
		const result = await f.client.callTool({name: 'list_accounts', arguments: {}});
		assert.equal(result.isError, true);
		assert.match(result.content[0].text, expected);
		assert.doesNotMatch(JSON.stringify(result), /upstream-sensitive-payload|synthetic-test-token/);
	});
}

test('network failures do not expose request credentials or origin details', async (t) => {
	const f = await fixture(t, {apiUrl: 'http://127.0.0.1:0/api'});
	const result = await f.client.callTool({name: 'list_accounts', arguments: {}});
	assert.equal(result.isError, true);
	assert.match(result.content[0].text, /network.*TEMPO_API_URL/i);
	assert.doesNotMatch(JSON.stringify(result), /synthetic-test-token|127\.0\.0\.1/);
});

test('invalid success JSON becomes a safe upstream response error', async (t) => {
	const f = await fixture(t);
	f.respond(`not-json ${TOKEN}`);
	const result = await f.client.callTool({name: 'list_accounts', arguments: {}});
	assert.equal(result.isError, true);
	assert.match(result.content[0].text, /invalid JSON/i);
	assert.doesNotMatch(JSON.stringify(result), /synthetic-test-token|not-json/);
});
