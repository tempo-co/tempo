import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {loadConfig} from '../dist/config.js';

// Only use a disposable API with synthetic fixtures. This script never creates or revokes a token.
let client;
let currentTool = 'configuration';
try {
	const {apiUrl, apiToken} = loadConfig();
	const url = new URL(apiUrl);
	if (!process.env.TEMPO_API_URL || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error();
	const id = z.uuidv4().parse(process.env.TEMPO_SMOKE_TRANSACTION_ID);
	const transport = new StdioClientTransport({
		command: process.execPath,
		args: [fileURLToPath(new URL('../dist/stdio.js', import.meta.url))],
		env: {TEMPO_API_URL: apiUrl, TEMPO_API_TOKEN: apiToken},
		stderr: 'pipe',
	});
	client = new Client({name: 'tempo-disposable-api-smoke', version: '1'});
	await client.connect(transport);
	const tools = (await client.listTools()).tools;
	const calls = [
		['list_accounts', {}],
		['month_summary', {month: '2000-01', asOf: '2000-02-01'}],
		['cash_flow', {interval: 'month', from: '2000-01-01', to: '2000-01-31', asOf: '2000-02-01'}],
		['balance_trend', {interval: 'month', from: '2000-01-01', to: '2000-01-31', asOf: '2000-02-01'}],
		['search_transactions', {page: 0, pageSize: 5}],
		['transaction_totals', {}],
		['get_transaction', {id}],
		['review_counts', {}],
		['list_categories', {}],
	];
	if (JSON.stringify(tools.map((tool) => tool.name).sort()) !== JSON.stringify(calls.map(([name]) => name).sort()))
		throw new Error();
	for (const [name, args] of calls) {
		currentTool = name;
		const result = await client.callTool({name, arguments: args});
		if (result.isError || result.content?.[0]?.type !== 'text') throw new Error();
		const value = JSON.parse(result.content[0].text);
		if (name === 'transaction_totals') {
			z.object({
				baseCurrency: z.string().nullable(),
				spending: z.string().regex(/^-?\d+\.\d{2}$/),
				income: z.string().regex(/^-?\d+\.\d{2}$/),
				net: z.string().regex(/^-?\d+\.\d{2}$/),
				count: z.int().nonnegative(),
				excluded: z.object({unknownDirection: z.int().nonnegative(), missingBaseAmount: z.int().nonnegative()}),
			}).parse(value);
		}
		if (name === 'get_transaction' && value.id !== id) throw new Error();
		console.log(`PASS ${name}`);
	}
	console.log('PASS 9 tools through SDK stdio and the disposable API');
} catch {
	console.error(
		`Tempo MCP API smoke failed at ${currentTool}. Check the disposable loopback API, token and synthetic transaction fixture.`,
	);
	process.exitCode = 1;
} finally {
	await client?.close();
}
