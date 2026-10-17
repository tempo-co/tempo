import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, readdir, rm, stat} from 'node:fs/promises';
import http from 'node:http';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const fixture = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));
const payload = {
	input: {
		categories: [{value: 'SHOPPING', label: 'Shopping', description: 'General retail goods.'}],
		transactions: [
			{
				correlationId: '0',
				transactionDate: null,
				bookingDate: null,
				valueDate: null,
				amount: '-12.34',
				currency: 'EUR',
				creditDebitIndicator: 'DBIT',
				direction: 'EXPENSE',
				transactionType: 'CARD',
				bankTransactionCode: null,
				bankTransactionSubCode: null,
				description: 'Example Shop',
				counterpartyName: null,
				bankTransactionDescription: null,
				merchantCategoryCode: null,
				remittanceInformation: null,
			},
		],
	},
};
const contractFile = fileURLToPath(new URL('./contract.json', import.meta.url));
const contractHash = createHash('sha256')
	.update(JSON.stringify(JSON.parse(await readFile(contractFile, 'utf8'))))
	.digest('hex');
const expected = {classifications: [{correlationId: '0', category: 'SHOPPING', confidence: 0.9}]};

function request(socketPath, body = payload, options = {}) {
	return new Promise((resolve, reject) => {
		const encoded = typeof body === 'string' ? body : JSON.stringify(body);
		const req = http.request(
			{
				socketPath,
				path: '/categorize',
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'content-length': Buffer.byteLength(encoded),
					'x-tempo-contract': contractHash,
				},
				...options,
			},
			(res) => {
				let text = '';
				res.setEncoding('utf8');
				res.on('data', (chunk) => {
					text += chunk;
				});
				res.on('end', () => resolve({status: res.statusCode, body: JSON.parse(text)}));
			},
		);
		req.on('error', reject);
		req.end(typeof body === 'string' ? body : JSON.stringify(body));
	});
}

async function setup(t, {mode = 'success', ...options} = {}) {
	const root = await mkdtemp(path.join(tmpdir(), 'tempo-bridge-test-'));
	t.after(() => rm(root, {recursive: true, force: true}));
	const calls = [];
	const {startBridge} = await import('./bridge.mjs');
	const bridge = await startBridge({
		socketPath: path.join(root, 'private', 'bridge.sock'),
		verifyUsage: async () => {},
		tokenExpiresAt: async () => Date.now() + 60 * 60 * 1000,
		claudePath: '/synthetic/claude',
		spawnProcess(command, args, opts) {
			const child = spawn(process.execPath, [fixture, mode, ...args], opts);
			const call = {command, args, opts, child, stdin: undefined};
			const end = child.stdin.end.bind(child.stdin);
			child.stdin.end = (input, ...rest) => {
				if (typeof input === 'string') call.stdin = input;
				return end(input, ...rest);
			};
			calls.push(call);
			return child;
		},
		...options,
	});
	t.after(() => bridge.close());
	return {bridge, calls, root, socketPath: bridge.socketPath};
}

test('categorizes through a real private Unix HTTP socket with the canonical contract', async (t) => {
	const {socketPath, calls} = await setup(t);
	assert.deepEqual(await request(socketPath), {status: 200, body: expected});
	assert.equal((await stat(path.dirname(socketPath))).mode & 0o777, 0o700);
	assert.equal((await stat(socketPath)).mode & 0o777, 0o600);
	assert.equal(calls[0].args.join(' '), 'auth status --json');
	const call = calls.at(-1);
	const contract = JSON.parse(await readFile(new URL('./contract.json', import.meta.url), 'utf8'));
	assert.deepEqual(call.args, [
		'-p',
		'--model',
		'claude-opus-5-5',
		'--effort',
		'medium',
		'--system-prompt',
		contract.instructions,
		'--tools',
		'',
		'--strict-mcp-config',
		'--setting-sources',
		'',
		'--disable-slash-commands',
		'--no-session-persistence',
		'--permission-mode',
		'dontAsk',
		'--output-format',
		'stream-json',
		'--verbose',
		'--json-schema',
		JSON.stringify(contract.schema),
	]);
});

test('rejects invalid or nonstandard inputs without spawning a categorizer', async (t) => {
	const {socketPath, calls} = await setup(t);
	const invalid = [
		{...payload, model: 'caller-model'},
		{...payload, system: 'caller-system'},
		{input: {...payload.input, schema: {}}},
		{input: {...payload.input, transactions: []}},
		{
			input: {
				...payload.input,
				transactions: Array.from({length: 51}, (_, i) => ({
					...payload.input.transactions[0],
					correlationId: String(i),
				})),
			},
		},
		{input: {...payload.input, transactions: [payload.input.transactions[0], payload.input.transactions[0]]}},
		{
			input: {
				...payload.input,
				transactions: [{...payload.input.transactions[0], correlationId: 'private-row-identifier'}],
			},
		},
		{input: {...payload.input, transactions: [{...payload.input.transactions[0], accountNumber: 'secret'}]}},
		{input: {...payload.input, transactions: [{...payload.input.transactions[0], amount: {command: 'run'}}]}},
		{
			input: {
				...payload.input,
				transactions: [
					{
						...payload.input.transactions[0],
						merchantLocation: {city: 'Example', region: null, country: 'XX', secret: 'x'},
					},
				],
			},
		},
		{
			input: {
				...payload.input,
				transactions: [
					{
						...payload.input.transactions[0],
						previousManualCategories: [
							{category: 'SHOPPING', count: 1, recentExamples: [{amount: '-1', date: null, secret: 'x'}]},
						],
					},
				],
			},
		},
		{input: {...payload.input, categories: [{value: 'NOT_A_CATEGORY', label: 'Fake', description: 'Fake'}]}},
		'not json',
	];
	for (const body of invalid) assert.equal((await request(socketPath, body)).status, 400);
	assert.equal((await request(socketPath, payload, {method: 'GET'})).status, 404);
	assert.equal((await request(socketPath, payload, {path: '/arbitrary'})).status, 404);
	assert.equal((await request(socketPath, payload, {headers: {'content-type': 'text/plain'}})).status, 415);
	assert.equal(calls.length, 1);
});

test('isolates CLI environment, stdin and empty working directory', async (t) => {
	const poisoned = {
		...process.env,
		ANTHROPIC_API_KEY: 'synthetic-secret',
		ANTHROPIC_AUTH_TOKEN: 'synthetic-token',
		CLAUDE_CODE_OAUTH_TOKEN: 'synthetic-token',
		ANTHROPIC_BASE_URL: 'https://example.com',
		CLAUDE_CODE_USE_BEDROCK: '1',
		CLAUDE_CONFIG_DIR: '/synthetic/config',
		NODE_OPTIONS: '--bad-option',
		HTTPS_PROXY: 'http://example.com',
		AWS_ACCESS_KEY_ID: 'synthetic-key',
		GOOGLE_APPLICATION_CREDENTIALS: '/synthetic/key',
	};
	const {socketPath, calls} = await setup(t, {env: poisoned});
	assert.deepEqual(await request(socketPath, {...payload, model: 'claude-opus-5-5'}), {status: 200, body: expected});
	for (const {opts} of calls) {
		assert.equal(opts.shell, false);
		assert.equal(opts.detached, true);
		for (const key of Object.keys(poisoned)) {
			if (!['HOME', 'PATH', 'LANG', 'LC_ALL'].includes(key)) assert.equal(opts.env[key], undefined, key);
		}
		assert.equal(opts.env.HOME, process.env.HOME);
		assert.equal(opts.env.PATH, process.env.PATH);
		assert.equal(opts.env.DISABLE_TELEMETRY, '1');
		assert.equal(opts.env.DISABLE_ERROR_REPORTING, '1');
		assert.equal(opts.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, '1');
		assert.equal(path.dirname(opts.cwd), path.dirname(socketPath));
	}
	assert.deepEqual(await readdir(path.dirname(socketPath)), ['bridge.sock']);
});

test('rejects unsafe CLI runtime initialization and overage before accepting a result', async (t) => {
	for (const mode of [
		'api-key',
		'tools',
		'mcp',
		'overage',
		'overage-allowed',
		'no-rate-limit',
		'no-init',
		'tool-call',
	]) {
		await t.test(mode, async (t) => {
			const {socketPath} = await setup(t, {mode});
			assert.deepEqual(await request(socketPath), {status: 503, body: {error: 'claude_unavailable'}});
		});
	}
});

test('returns sanitized 503 for quota, CLI errors and invalid classification output', async (t) => {
	for (const mode of [
		'quota',
		'cli-error',
		'bad-json',
		'missing-result',
		'failure-result',
		'wrong-id',
		'duplicate-id',
		'missing-id',
		'bad-category',
		'bad-confidence',
		'extra-output-field',
	]) {
		await t.test(mode, async (t) => {
			const {socketPath} = await setup(t, {mode});
			assert.deepEqual(await request(socketPath), {status: 503, body: {error: 'claude_unavailable'}});
		});
	}
});

test('bounds request bodies before JSON parsing for fixed-length and chunked clients', async (t) => {
	const {socketPath, calls} = await setup(t);
	const large = ' '.repeat(1024 * 1024) + JSON.stringify(payload);
	assert.equal((await request(socketPath, large)).status, 413);
	assert.equal(
		(
			await request(socketPath, large, {
				headers: {'content-type': 'application/json', 'x-tempo-contract': contractHash},
			})
		).status,
		413,
	);
	assert.equal(calls.length, 1);
});

test('decodes a multibyte character split across request chunks', async (t) => {
	const {socketPath, calls} = await setup(t);
	const body = Buffer.from(
		JSON.stringify({
			input: {...payload.input, transactions: [{...payload.input.transactions[0], description: 'Example Café'}]},
		}),
	);
	const split = body.indexOf(Buffer.from('é')) + 1;
	const status = await new Promise((resolve, reject) => {
		const req = http.request(
			{
				socketPath,
				path: '/categorize',
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'content-length': body.length,
					'x-tempo-contract': contractHash,
				},
			},
			(res) => {
				res.resume();
				res.on('end', () => resolve(res.statusCode));
			},
		);
		req.on('error', reject);
		req.write(body.subarray(0, split));
		setTimeout(() => req.end(body.subarray(split)), 50);
	});
	assert.equal(status, 200);
	assert.match(calls.at(-1).stdin, /Example Café/);
});

test('bounds combined child stdout and stderr', async (t) => {
	for (const mode of ['large-stdout', 'large-stderr'])
		await t.test(mode, async (t) => {
			const {socketPath} = await setup(t, {mode});
			assert.deepEqual(await request(socketPath), {status: 503, body: {error: 'claude_unavailable'}});
		});
});

test('times out and reaps the CLI process', async (t) => {
	const {socketPath, calls} = await setup(t, {mode: 'delay', timeoutMs: 300});
	assert.deepEqual(await request(socketPath), {status: 503, body: {error: 'claude_unavailable'}});
	assert.deepEqual(await readdir(path.dirname(socketPath)), ['bridge.sock']);
	assert.equal(calls.length, 2);
});

test('accepts a near-limit subscription warning while overage stays rejected', async (t) => {
	const {socketPath} = await setup(t, {mode: 'near-limit'});
	assert.deepEqual(await request(socketPath), {status: 200, body: expected});
});

test('still refuses overage under a near-limit warning', async (t) => {
	const {socketPath} = await setup(t, {mode: 'near-limit-overage'});
	assert.deepEqual(await request(socketPath), {status: 503, body: {error: 'claude_unavailable'}});
});

test('rejects concurrent requests without launching another child', async (t) => {
	const {socketPath, calls} = await setup(t, {mode: 'delay'});
	const first = request(socketPath);
	while (calls.length < 2) await new Promise((resolve) => setTimeout(resolve, 10));
	assert.deepEqual(await request(socketPath), {status: 503, body: {error: 'claude_busy'}});
	assert.deepEqual(await first, {status: 200, body: expected});
	assert.equal(calls.length, 2);
});

test('renews an expired subscription login through the CLI before checking usage', async (t) => {
	let expiresAt = Date.now() - 1000;
	const order = [];
	const {socketPath, calls} = await setup(t, {
		tokenExpiresAt: async () => expiresAt,
		verifyUsage: async () => order.push('usage'),
	});
	const commands = () => calls.map((call) => call.args[0]);
	assert.deepEqual(commands(), ['auth', 'doctor']);
	assert.deepEqual(order, ['usage']);
	expiresAt = Date.now() + 60 * 60 * 1000;
	assert.deepEqual(await request(socketPath), {status: 200, body: expected});
	assert.deepEqual(commands(), ['auth', 'doctor', '-p']);
	expiresAt = Date.now() + 1000;
	assert.deepEqual(await request(socketPath), {status: 200, body: expected});
	assert.deepEqual(commands(), ['auth', 'doctor', '-p', 'doctor', '-p']);
	assert.equal(calls[1].stdin, '');
});

test('fails closed when the CLI cannot renew an expired login', async (t) => {
	await assert.rejects(setup(t, {mode: 'doctor-fail', tokenExpiresAt: async () => 0}), {
		message: 'Claude unavailable.',
	});
});

test('requires first-party Max or Pro subscription authentication at startup', async (t) => {
	for (const mode of ['logged-out', 'console-auth', 'enterprise-auth', 'third-party-auth'])
		await t.test(mode, async (t) => {
			await assert.rejects(setup(t, {mode}), {message: 'Claude subscription authentication required.'});
		});
});

test('checks live extra usage at startup and again before each categorizer launch', async (t) => {
	let checks = 0;
	const {socketPath, calls} = await setup(t, {
		verifyUsage: async () => {
			checks += 1;
			if (checks > 1) throw new Error('synthetic-sensitive-policy-failure');
		},
	});
	assert.equal(checks, 1);
	assert.deepEqual(await request(socketPath), {status: 503, body: {error: 'claude_unavailable'}});
	assert.equal(checks, 2);
	assert.equal(calls.length, 1);
	await assert.rejects(
		setup(t, {
			verifyUsage: async () => {
				throw new Error('usage enabled');
			},
		}),
	);
});

test('does not follow a symlink for the private socket directory', async (t) => {
	const root = await mkdtemp(path.join(tmpdir(), 'tempo-bridge-test-'));
	t.after(() => rm(root, {recursive: true, force: true}));
	const {mkdir, symlink} = await import('node:fs/promises');
	await mkdir(path.join(root, 'target'), {mode: 0o755});
	await symlink(path.join(root, 'target'), path.join(root, 'link'));
	const {startBridge} = await import('./bridge.mjs');
	await assert.rejects(
		startBridge({
			socketPath: path.join(root, 'link', 'bridge.sock'),
			claudePath: '/nonexistent/claude',
			verifyUsage: async () => {},
		}),
		{message: 'Unsafe Claude socket directory.'},
	);
	assert.equal((await stat(path.join(root, 'target'))).mode & 0o777, 0o755);
});

test('kills an in-flight CLI when its HTTP caller disconnects', async (t) => {
	const {socketPath, calls} = await setup(t, {mode: 'delay'});
	const req = http.request({
		socketPath,
		method: 'POST',
		path: '/categorize',
		headers: {'content-type': 'application/json', 'x-tempo-contract': contractHash},
	});
	req.on('error', () => {});
	req.end(JSON.stringify(payload));
	while (calls.length < 2) await new Promise((resolve) => setTimeout(resolve, 10));
	const child = calls.at(-1).child;
	const closed = new Promise((resolve) => child.once('close', () => resolve('closed')));
	req.destroy();
	assert.equal(
		await Promise.race([closed, new Promise((resolve) => setTimeout(() => resolve('still running'), 250))]),
		'closed',
	);
	assert.throws(() => process.kill(child.pid, 0), {code: 'ESRCH'});
});

test('shutdown kills and reaps its child and removes only its own socket', async (t) => {
	const {socketPath, calls, bridge} = await setup(t, {mode: 'delay'});
	const pending = request(socketPath).catch(() => null);
	while (calls.length < 2) await new Promise((resolve) => setTimeout(resolve, 10));
	assert.equal(
		await Promise.race([
			bridge.close().then(() => 'closed'),
			new Promise((resolve) => setTimeout(() => resolve('still running'), 250)),
		]),
		'closed',
	);
	await pending;
	assert.throws(() => process.kill(calls.at(-1).child.pid, 0), {code: 'ESRCH'});
	assert.deepEqual(await readdir(path.dirname(socketPath)), []);
});

const searchPayload = {
	model: 'claude-opus-5-5',
	input: {
		categories: payload.input.categories,
		transactions: [
			{
				correlationId: '0',
				amount: '-12.34',
				currency: 'EUR',
				direction: 'EXPENSE',
				transactionType: 'CARD',
				merchantName: 'Example Shop',
				merchantLocation: 'Utrecht',
				searchQuery: 'Example Shop Utrecht',
				merchantCategoryCode: null,
			},
		],
	},
};
const searchRequest = (socketPath, body = searchPayload) =>
	request(socketPath, body, {path: '/categorize-with-search'});

test('searches once with the pinned query hook and returns only source hostnames', async (t) => {
	const {socketPath, calls} = await setup(t);
	assert.deepEqual(await searchRequest(socketPath), {
		status: 200,
		body: {
			classifications: [
				{correlationId: '0', category: 'SHOPPING', confidence: 0.9, evidenceType: 'MERCHANT_IDENTITY_ONLY'},
			],
			sourceDomains: ['www.example.test', 'shop.example.test'],
		},
	});
	const contract = JSON.parse(await readFile(new URL('./contract.json', import.meta.url), 'utf8'));
	const {args, stdin} = calls.at(-1);
	const value = (flag) => args[args.indexOf(flag) + 1];
	assert.equal(value('--tools'), 'WebSearch');
	assert.equal(value('--system-prompt'), contract.webSearch.instructions);
	assert.equal(value('--json-schema'), JSON.stringify(contract.webSearch.schema));
	assert.equal(value('--setting-sources'), '');
	assert.equal(value('--permission-mode'), 'dontAsk');
	assert.ok(!args.some((arg) => /allowed-?tools/i.test(arg)));
	const hook = JSON.parse(value('--settings')).hooks.PreToolUse;
	assert.equal(hook.length, 1);
	assert.equal(hook[0].matcher, 'WebSearch');
	assert.match(hook[0].hooks[0].command, /search-hook\.mjs'$/);
	assert.deepEqual(JSON.parse(stdin), searchPayload.input);
	assert.deepEqual(await readdir(path.dirname(socketPath)), ['bridge.sock']);
});

test('refuses a search result unless exactly one pinned search succeeded', async (t) => {
	for (const mode of [
		'search-none',
		'search-twice',
		'search-other-query',
		'search-denied',
		'search-no-evidence',
		'tools',
		'tool-call',
		'overage',
		'near-limit-overage',
	])
		await t.test(mode, async (t) => {
			const {socketPath} = await setup(t, {mode});
			assert.deepEqual(await searchRequest(socketPath), {status: 503, body: {error: 'claude_unavailable'}});
		});
});

test('rejects malformed search requests without spawning a categorizer', async (t) => {
	const {socketPath, calls} = await setup(t);
	const tx = searchPayload.input.transactions[0];
	const withTx = (transactions) => ({...searchPayload, input: {...searchPayload.input, transactions}});
	for (const body of [
		withTx([tx, {...tx, correlationId: '1'}]),
		withTx([{...tx, searchQuery: ''}]),
		withTx([{...tx, searchQuery: 'x'.repeat(241)}]),
		withTx([{...tx, description: 'Example Shop'}]),
		withTx([{...tx, merchantName: undefined}]),
		payload,
	])
		assert.equal((await searchRequest(socketPath, body)).status, 400);
	assert.equal(calls.length, 1);
});

test('keeps the standard route tool-free even when the CLI tries a search', async (t) => {
	const {socketPath} = await setup(t, {mode: 'standard-search'});
	assert.deepEqual(await request(socketPath), {status: 503, body: {error: 'claude_unavailable'}});
});

export {payload, expected, request, setup};

test('reports the running contract without starting Claude', async (t) => {
	const {socketPath, calls} = await setup(t);
	const before = calls.length;
	assert.deepEqual(await request(socketPath, '', {method: 'GET', path: '/contract'}), {
		status: 200,
		body: {hash: contractHash},
	});
	assert.equal(calls.length, before);
});

for (const route of ['/categorize', '/categorize-with-search'])
	for (const [name, hash] of [
		['a different', 'a'.repeat(64)],
		['no', undefined],
	])
		test(`${route} refuses ${name} contract hash before running Claude`, async (t) => {
			const {socketPath, calls} = await setup(t);
			const before = calls.length;
			const headers = {'content-type': 'application/json', ...(hash ? {'x-tempo-contract': hash} : {})};
			assert.deepEqual(await request(socketPath, payload, {path: route, headers}), {
				status: 409,
				body: {error: 'contract_mismatch'},
			});
			assert.equal(calls.length, before);
		});
