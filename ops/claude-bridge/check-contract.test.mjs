import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import http from 'node:http';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {checkContract} from './check-contract.mjs';

const hash = 'a'.repeat(64);
const unavailable = 'Claude fallback contract check failed; bridge or API unavailable.';

async function withBridge(t, body, run, status = 200) {
	const root = await mkdtemp(path.join(tmpdir(), 'contract-probe-'));
	const socketPath = path.join(root, 'bridge.sock');
	const server = http.createServer((req, res) => {
		assert.equal(req.method, 'GET');
		assert.equal(req.url, '/contract');
		res.writeHead(status, {'content-type': 'application/json'}).end(body);
	});
	await new Promise((resolve) => server.listen(socketPath, resolve));
	t.after(async () => {
		await new Promise((resolve) => server.close(resolve));
		await rm(root, {recursive: true, force: true});
	});
	return run({socketPath, readApiHash: async () => hash});
}

test('stays silent when the running bridge and API contracts agree', async (t) => {
	await withBridge(t, JSON.stringify({hash}), async (options) => {
		assert.equal(await checkContract(options), '');
	});
});

test('reports a mismatch before any categorization request is needed', async (t) => {
	await withBridge(t, JSON.stringify({hash: 'b'.repeat(64)}), async (options) => {
		assert.equal(
			await checkContract(options),
			'Claude fallback contract differs from the running API; reinstall and restart the bridge.',
		);
	});
});

for (const [label, body, status] of [
	['an old bridge', '{"error":"not_found"}', 404],
	['a malformed reply', 'not json', 200],
	['a missing hash', '{}', 200],
	['an invalid hash', '{"hash":"synthetic-private-value"}', 200],
	['an oversized reply', 'x'.repeat(8192), 200],
])
	test(`reports ${label} without leaking its reply`, async (t) => {
		await withBridge(
			t,
			body,
			async (options) => {
				assert.equal(await checkContract(options), unavailable);
			},
			status,
		);
	});

test('reports an unavailable API without leaking command errors', async (t) => {
	await withBridge(t, JSON.stringify({hash}), async (options) => {
		assert.equal(
			await checkContract({
				...options,
				readApiHash: async () => {
					throw new Error('synthetic-private-value');
				},
			}),
			unavailable,
		);
	});
});

test('reports a missing bridge socket', async () => {
	assert.equal(
		await checkContract({socketPath: '/nonexistent/bridge.sock', readApiHash: async () => hash}),
		unavailable,
	);
});

test('bounds a stalled bridge response with the safe failure reason', {timeout: 7500}, async (t) => {
	const root = await mkdtemp(path.join(tmpdir(), 'contract-stalled-'));
	const socketPath = path.join(root, 'bridge.sock');
	const server = http.createServer(() => {});
	await new Promise((resolve) => server.listen(socketPath, resolve));
	t.after(async () => {
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
		await rm(root, {recursive: true, force: true});
	});
	assert.equal(await checkContract({socketPath, readApiHash: async () => hash}), unavailable);
});

test('rejects an invalid API hash rather than treating it as a mismatch', async (t) => {
	await withBridge(t, JSON.stringify({hash}), async (options) => {
		assert.equal(await checkContract({...options, readApiHash: async () => 'not-a-hash'}), unavailable);
	});
});
