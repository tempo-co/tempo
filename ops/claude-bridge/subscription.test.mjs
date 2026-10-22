import assert from 'node:assert/strict';
import {Readable, Writable} from 'node:stream';
import test from 'node:test';

// Refreshed logins no longer store the plan, so the fixture carries only the token.
const credentials = JSON.stringify({claudeAiOauth: {accessToken: 'synthetic-token'}});
const failure = {message: 'Cannot verify the Claude subscription is usable.'};

// Fakes both OAuth endpoints; each takes {body, status, error, stalled}.
function boundary({profile = {}, usage = {}} = {}) {
	const endpoints = {
		profile: {body: {organization: {organization_type: 'claude_max'}}, status: 200, ...profile},
		usage: {body: {extra_usage: {is_enabled: false}}, status: 200, ...usage},
	};
	const calls = [];
	const request = (url, options, callback) => {
		calls.push({url: String(url), options});
		const {body, status, error, stalled} = endpoints[String(url).split('/').pop()];
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
	return {request, calls, endpoints};
}

test('checks the plan and extra usage on the fixed OAuth endpoints without exposing the token', async () => {
	const {assertSubscriptionUsable} = await import('./subscription.mjs');
	const {request, calls} = boundary();
	await assertSubscriptionUsable('/synthetic/home', {
		request,
		readCredentials: async (filename, encoding) => {
			assert.equal(filename, '/synthetic/home/.claude/.credentials.json');
			assert.equal(encoding, 'utf8');
			return credentials;
		},
	});
	const options = {
		method: 'GET',
		agent: false,
		headers: {
			Authorization: 'Bearer synthetic-token',
			'anthropic-beta': 'oauth-2025-04-20',
			Accept: 'application/json',
		},
	};
	assert.deepEqual(calls, [
		{url: 'https://api.anthropic.com/api/oauth/profile', options},
		{url: 'https://api.anthropic.com/api/oauth/usage', options},
	]);
});

test('reads the stored login expiry, treating unreadable credentials as expired', async () => {
	const {storedTokenExpiresAt} = await import('./subscription.mjs');
	const read = (text) => ({readCredentials: async () => text});
	assert.equal(await storedTokenExpiresAt('/synthetic/home', read('{"claudeAiOauth":{"expiresAt":1234}}')), 1234);
	assert.equal(await storedTokenExpiresAt('/synthetic/home', read('{"claudeAiOauth":{}}')), 0);
	assert.equal(await storedTokenExpiresAt('/synthetic/home', read('not json')), 0);
});

test('fails closed on an expired stored token instead of letting inference run unverified', async () => {
	const {assertSubscriptionUsable} = await import('./subscription.mjs');
	const {request, calls} = boundary({profile: {status: 401}, usage: {status: 401}});
	const expired = JSON.stringify({claudeAiOauth: {accessToken: 'synthetic-token', expiresAt: Date.now() - 1000}});
	await assert.rejects(
		assertSubscriptionUsable('/synthetic/home', {request, readCredentials: async () => expired}),
		failure,
	);
	assert.equal(calls.length, 1);
});

const unreachable = [
	{body: 'not json'},
	{status: 429},
	{status: 401},
	{status: 302},
	{error: true},
	{stalled: true},
	{body: 'x'.repeat(70 * 1024)},
];

async function assertRejected(t, name, endpoints, expectedCalls) {
	const {assertSubscriptionUsable} = await import('./subscription.mjs');
	await t.test(name, async () => {
		const {request, calls} = boundary(endpoints);
		await assert.rejects(
			assertSubscriptionUsable('/synthetic/home', {
				request,
				timeoutMs: 50,
				readCredentials: async () => credentials,
			}),
			failure,
		);
		assert.equal(calls.length, expectedCalls);
	});
}

test('fails closed on enabled, missing, malformed or unreachable extra-usage status', async (t) => {
	for (const usage of [
		{body: {extra_usage: {is_enabled: true}}},
		{body: {}},
		{body: {extra_usage: null}},
		{body: {extra_usage: {is_enabled: 'false'}}},
		...unreachable,
	])
		await assertRejected(t, JSON.stringify(usage).slice(0, 80), {usage}, 2);
	const {assertSubscriptionUsable} = await import('./subscription.mjs');
	await assert.rejects(
		assertSubscriptionUsable('/synthetic/home', {readCredentials: async () => 'private invalid JSON'}),
		failure,
	);
});

test('fails closed unless the account profile shows a Max or Pro plan', async (t) => {
	for (const profile of [
		{body: {organization: {organization_type: 'claude_enterprise'}}},
		{body: {organization: {organization_type: 'max'}}},
		{body: {organization: {}}},
		{body: {}},
		{body: null},
		...unreachable,
	])
		await assertRejected(t, JSON.stringify(profile).slice(0, 80), {profile}, 1);
	const {assertSubscriptionUsable} = await import('./subscription.mjs');
	const {request} = boundary({profile: {body: {organization: {organization_type: 'claude_pro'}}}});
	await assertSubscriptionUsable('/synthetic/home', {request, readCredentials: async () => credentials});
});

const minute = 60 * 1000;

test('reuses a pass for five minutes per unexpired login; a new login, expiry or failure checks again', async () => {
	const {createSubscriptionCheck} = await import('./subscription.mjs');
	let now = 1_000_000;
	let stored = {claudeAiOauth: {accessToken: 'synthetic-token', expiresAt: now + 60 * minute}};
	const {request, calls, endpoints} = boundary();
	const check = createSubscriptionCheck({
		request,
		now: () => now,
		readCredentials: async () => JSON.stringify(stored),
	});
	await check('/synthetic/home');
	assert.equal(calls.length, 2);
	now += 5 * minute - 1;
	await check('/synthetic/home');
	assert.equal(calls.length, 2);
	now += 1;
	await check('/synthetic/home');
	assert.equal(calls.length, 4);
	stored = {claudeAiOauth: {accessToken: 'synthetic-other-token', expiresAt: now + 60 * minute}};
	await check('/synthetic/home');
	assert.equal(calls.length, 6);
	stored = {claudeAiOauth: {accessToken: 'synthetic-other-token'}};
	await check('/synthetic/home');
	assert.equal(calls.length, 8);
	stored = {claudeAiOauth: {accessToken: 'synthetic-other-token', expiresAt: now - 1}};
	endpoints.profile.status = 401;
	await assert.rejects(check('/synthetic/home'), failure);
	assert.equal(calls.length, 9);
	stored = {claudeAiOauth: {accessToken: 'synthetic-other-token', expiresAt: now + 60 * minute}};
	endpoints.profile.status = 200;
	endpoints.usage.body = {extra_usage: {is_enabled: true}};
	await assert.rejects(check('/synthetic/home'), failure);
	await assert.rejects(check('/synthetic/home'), failure);
	assert.equal(calls.length, 13);
});

test('rides out a rate-limited check for fifteen minutes after the last pass; other failures fail closed', async () => {
	const {createSubscriptionCheck} = await import('./subscription.mjs');
	let now = 1_000_000;
	const stored = JSON.stringify({claudeAiOauth: {accessToken: 'synthetic-token', expiresAt: now + 120 * minute}});
	const {request, calls, endpoints} = boundary();
	const check = createSubscriptionCheck({request, now: () => now, readCredentials: async () => stored});
	await check('/synthetic/home');
	now += 15 * minute - 1;
	endpoints.profile.status = 429;
	await check('/synthetic/home');
	assert.equal(calls.length, 3);
	now += 1;
	await assert.rejects(check('/synthetic/home'), failure);
	endpoints.profile.status = 200;
	await check('/synthetic/home');
	now += 6 * minute;
	endpoints.profile.status = 401;
	await assert.rejects(check('/synthetic/home'), failure);
	endpoints.profile.status = 429;
	await assert.rejects(check('/synthetic/home'), failure);
	assert.equal(calls.length, 8);
});
