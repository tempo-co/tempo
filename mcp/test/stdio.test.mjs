import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fixture, json, TOKEN} from './helpers.mjs';

export const TOOL_NAMES = [
	'balance_trend',
	'cash_flow',
	'get_transaction',
	'list_accounts',
	'list_categories',
	'month_summary',
	'review_counts',
	'search_transactions',
	'transaction_totals',
];
const entry = fileURLToPath(new URL('../dist/stdio.js', import.meta.url));

test('SDK stdio initializes, advertises exactly nine read-only tools and calls HTTP with the configured token', async (t) => {
	const f = await fixture(t);
	const transport = new StdioClientTransport({
		command: process.execPath,
		args: [entry],
		env: {TEMPO_API_URL: `${f.apiUrl}/`, TEMPO_API_TOKEN: TOKEN},
		stderr: 'pipe',
	});
	let stderr = '';
	transport.stderr.on('data', (chunk) => (stderr += chunk));
	const client = new Client({name: 'synthetic-stdio-test', version: '1'});
	const errors = [];
	client.onerror = (error) => errors.push(error);
	t.after(() => client.close());
	await client.connect(transport);
	const tools = (await client.listTools()).tools;
	assert.deepEqual(tools.map((tool) => tool.name).sort(), TOOL_NAMES);
	for (const tool of tools) {
		assert.deepEqual(tool.annotations, {
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: true,
		});
		assert.equal(tool.inputSchema.additionalProperties, false);
	}
	f.respond([{baseCurrency: 'EUR', bankAccounts: [], syncStatus: 'IDLE'}]);
	assert.deepEqual(json(await client.callTool({name: 'list_accounts', arguments: {}})), [
		{baseCurrency: 'EUR', bankAccounts: [], syncStatus: 'IDLE'},
	]);
	assert.deepEqual(f.requests, [{method: 'GET', url: '/api/bank-connections', authorization: `Bearer ${TOKEN}`}]);
	await client.close();
	assert.deepEqual(errors, [], 'all stdout must parse as MCP protocol');
	assert.equal(stderr, '');
});

test('startup configuration failures write only a safe stderr diagnostic', () => {
	for (const env of [
		{TEMPO_API_TOKEN: ''},
		{TEMPO_API_URL: 'https://synthetic:synthetic-secret@example.test/api', TEMPO_API_TOKEN: TOKEN},
	]) {
		const result = spawnSync(process.execPath, [entry], {
			env: {...process.env, ...env},
			encoding: 'utf8',
			timeout: 5000,
		});
		assert.equal(result.status, 1);
		assert.equal(result.stdout, '');
		assert.match(result.stderr, /TEMPO_API_(TOKEN|URL)/);
		assert.doesNotMatch(result.stderr, /synthetic-secret|synthetic-test-token|Error:| at /);
	}
});
