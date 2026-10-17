import assert from 'node:assert/strict';
import {Readable, Writable} from 'node:stream';
import test from 'node:test';

const credentials = JSON.stringify({claudeAiOauth: {accessToken: 'synthetic-token', subscriptionType: 'max'}});

function boundary({body = {extra_usage: {is_enabled: false}}, status = 200, error, stalled = false} = {}) {
	const calls = [];
	const request = (url, options, callback) => {
		calls.push({url: String(url), options});
		const req = new Writable({
			write(_chunk, _encoding, done) {
				done();
			},
			final(done) {
				done();
				if (stalled) return;
				queueMicrotask(() => {
					if (error) return req.destroy(new Error('synthetic-sensitive-network-error'));
					const response = Readable.from([typeof body === 'string' ? body : JSON.stringify(body)]);
					response.statusCode = status;
					callback(response);
				});
			},
		});
		return req;
	};
	return {request, calls};
}

test('checks the fixed OAuth usage endpoint without exposing its token', async () => {
	const {assertExtraUsageDisabled} = await import('./subscription.mjs');
	const {request, calls} = boundary();
	await assertExtraUsageDisabled('/synthetic/home', {
		request,
		readCredentials: async (filename, encoding) => {
			assert.equal(filename, '/synthetic/home/.claude/.credentials.json');
			assert.equal(encoding, 'utf8');
			return credentials;
		},
	});
	assert.deepEqual(calls, [
		{
			url: 'https://api.anthropic.com/api/oauth/usage',
			options: {
				method: 'GET',
				agent: false,
				headers: {
					Authorization: 'Bearer synthetic-token',
					'anthropic-beta': 'oauth-2025-04-20',
					Accept: 'application/json',
				},
			},
		},
	]);
});

test('fails closed on an expired stored token instead of letting inference run unverified', async () => {
	const {assertExtraUsageDisabled} = await import('./subscription.mjs');
	const {request} = boundary({status: 401});
	const expired = JSON.stringify({
		claudeAiOauth: {accessToken: 'synthetic-token', subscriptionType: 'max', expiresAt: Date.now() - 1000},
	});
	await assert.rejects(assertExtraUsageDisabled('/synthetic/home', {request, readCredentials: async () => expired}), {
		message: 'Cannot verify Claude extra usage is disabled.',
	});
});

test('fails closed on enabled, missing, malformed or unreachable extra-usage status', async (t) => {
	const {assertExtraUsageDisabled} = await import('./subscription.mjs');
	for (const variant of [
		{body: {extra_usage: {is_enabled: true}}},
		{body: {}},
		{body: {extra_usage: null}},
		{body: {extra_usage: {is_enabled: 'false'}}},
		{body: 'not json'},
		{status: 429},
		{status: 401},
		{status: 302},
		{error: true},
		{stalled: true},
		{body: 'x'.repeat(70 * 1024)},
	])
		await t.test(JSON.stringify(variant).slice(0, 80), async () => {
			const {request} = boundary(variant);
			await assert.rejects(
				assertExtraUsageDisabled('/synthetic/home', {
					request,
					timeoutMs: 50,
					readCredentials: async () => credentials,
				}),
				{message: 'Cannot verify Claude extra usage is disabled.'},
			);
		});
	await assert.rejects(
		assertExtraUsageDisabled('/synthetic/home', {readCredentials: async () => 'private invalid JSON'}),
		{message: 'Cannot verify Claude extra usage is disabled.'},
	);
});
