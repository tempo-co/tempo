import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmod, lstat, mkdir, mkdtemp, realpath, rm, unlink, writeFile} from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import contract from './contract.json' with {type: 'json'};
import merchantContract from './merchant-contract.json' with {type: 'json'};
import {createSubscriptionCheck, storedTokenExpiresAt} from './subscription.mjs';
import {
	validMerchantRequest,
	validMerchantResponse,
	validRequest,
	validResponse,
	validSearchRequest,
} from './validation.mjs';

// Model and effort come from the validated request, so the CLI arguments start with them per call.
const cliArgs = ({instructions, schema}, tools, extra = []) => [
	'--system-prompt',
	instructions,
	'--tools',
	tools,
	'--strict-mcp-config',
	'--setting-sources',
	'',
	...extra,
	'--disable-slash-commands',
	'--no-session-persistence',
	'--permission-mode',
	'dontAsk',
	'--output-format',
	'stream-json',
	'--verbose',
	'--json-schema',
	JSON.stringify(schema),
];
const CLI_ARGS = cliArgs(contract, '');
const MERCHANT_CLI_ARGS = cliArgs(merchantContract, '');
// The API sends the hash of its own contract; a mismatch means one side was updated without the other. Merchant
// identification has its own contract file, so changing it never affects the categorization routes.
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const CONTRACT_HASH = hash(contract);
const MERCHANT_CONTRACT_HASH = hash(merchantContract);
const hookPath = fileURLToPath(new URL('./search-hook.mjs', import.meta.url));
if ([process.execPath, hookPath].some((part) => part.includes("'"))) throw new Error('Unsupported bridge path.');
// dontAsk denies every tool call that no hook allows; the hook allows only the one pinned search.
const SEARCH_CLI_ARGS = cliArgs(contract.webSearch, 'WebSearch', [
	'--settings',
	JSON.stringify({
		hooks: {
			PreToolUse: [
				{matcher: 'WebSearch', hooks: [{type: 'command', command: `'${process.execPath}' '${hookPath}'`}]},
			],
		},
	}),
]);

const ROUTES = new Map([
	[
		'/categorize',
		{
			args: CLI_ARGS,
			tools: ['StructuredOutput'],
			valid: validRequest,
			validOutput: validResponse,
			search: false,
			contractHash: CONTRACT_HASH,
		},
	],
	[
		'/categorize-with-search',
		{
			args: SEARCH_CLI_ARGS,
			tools: ['StructuredOutput', 'WebSearch'],
			valid: validSearchRequest,
			validOutput: (output, input) => validResponse(output, input, true),
			search: true,
			contractHash: CONTRACT_HASH,
		},
	],
	[
		'/identify-merchants',
		{
			args: MERCHANT_CLI_ARGS,
			tools: ['StructuredOutput'],
			valid: validMerchantRequest,
			validOutput: validMerchantResponse,
			search: false,
			contractHash: MERCHANT_CONTRACT_HASH,
			// Any model output means the run used quota, so a failure after it counts as an attempt (502).
			outputActs: true,
		},
	],
]);

/** Hostnames only: result paths and query strings never leave the bridge. The API normalizes the rest. */
function sourceDomains(results) {
	const domains = new Set();
	for (const result of results)
		for (const item of Array.isArray(result?.content) ? result.content : []) {
			try {
				const url = new URL(item.url);
				if (url.protocol === 'https:' || url.protocol === 'http:') domains.add(url.hostname);
			} catch {
				continue;
			}
		}
	return [...domains].slice(0, contract.webSearch.maxSourceDomains);
}

export async function startBridge({
	socketPath,
	claudePath = 'claude',
	spawnProcess = spawn,
	env = process.env,
	verifyUsage = createSubscriptionCheck(),
	tokenExpiresAt = storedTokenExpiresAt,
	timeoutMs = 120_000,
	maxOutputBytes = 256 * 1024,
} = {}) {
	socketPath ??= path.join(env.XDG_RUNTIME_DIR, 'tempo-claude', 'bridge.sock');
	if (typeof socketPath !== 'string' || !path.isAbsolute(socketPath))
		throw new Error('Absolute Claude socket path required.');
	const directory = path.dirname(socketPath);
	try {
		if ((await realpath(path.dirname(directory))) !== path.dirname(directory)) throw new Error();
		try {
			await mkdir(directory, {mode: 0o700});
		} catch (error) {
			if (error.code !== 'EEXIST') throw error;
		}
		const info = await lstat(directory);
		if (!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o700) throw new Error();
	} catch {
		throw new Error('Unsafe Claude socket directory.');
	}
	const childEnv = Object.fromEntries(
		['HOME', 'PATH', 'LANG', 'LC_ALL'].filter((key) => typeof env[key] === 'string').map((key) => [key, env[key]]),
	);
	Object.assign(childEnv, {
		DISABLE_TELEMETRY: '1',
		DISABLE_ERROR_REPORTING: '1',
		CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
	});
	let closing = false;
	const kills = new Set();
	const operations = new Set();
	function run(...args) {
		const operation = runChild(...args);
		operations.add(operation);
		operation.finally(() => operations.delete(operation)).catch(() => {});
		return operation;
	}
	async function runChild(args, input, onEvent, signal, files = {}) {
		const cwd = await mkdtemp(path.join(directory, 'request-'));
		try {
			for (const [name, content] of Object.entries(files))
				await writeFile(path.join(cwd, name), content, {mode: 0o600});
			if (closing || signal?.aborted) throw new Error('Claude unavailable.');
			return await new Promise((resolve, reject) => {
				const child = spawnProcess(claudePath, args, {
					cwd,
					env: childEnv,
					shell: false,
					detached: true,
					stdio: ['pipe', 'pipe', 'pipe'],
				});
				let output = '';
				let pending = '';
				let failed = false;
				let outputBytes = 0;
				const fail = () => {
					if (failed) return;
					failed = true;
					try {
						process.kill(-child.pid, 'SIGKILL');
					} catch {
						child.kill('SIGKILL');
					}
				};
				kills.add(fail);
				signal?.addEventListener('abort', fail, {once: true});
				const timer = setTimeout(fail, onEvent ? timeoutMs : 10_000);
				const countBytes = (chunk) => {
					outputBytes += Buffer.byteLength(chunk);
					if (outputBytes > maxOutputBytes) fail();
					return !failed;
				};
				const line = (text) => {
					if (!text.trim() || failed) return;
					try {
						onEvent(JSON.parse(text));
					} catch {
						fail();
					}
				};
				child.stdout.setEncoding('utf8');
				child.stdout.on('data', (chunk) => {
					if (!countBytes(chunk)) return;
					if (!onEvent) {
						output += chunk;
						return;
					}
					pending += chunk;
					let newline;
					while ((newline = pending.indexOf('\n')) !== -1) {
						line(pending.slice(0, newline));
						pending = pending.slice(newline + 1);
					}
				});
				child.stderr.on('data', countBytes);
				child.on('error', () => {
					failed = true;
				});
				child.stdin.on('error', fail);
				child.on('close', (code) => {
					clearTimeout(timer);
					kills.delete(fail);
					signal?.removeEventListener('abort', fail);
					if (onEvent && pending) line(pending);
					if (code === 0 && !failed) resolve(output);
					else reject(new Error('Claude unavailable.'));
				});
				child.stdin.end(input);
			});
		} finally {
			await rm(cwd, {recursive: true, force: true});
		}
	}
	// Only the CLI renews the subscription login, and `doctor` does so without inference. Renew it before the
	// subscription check, which refuses an expired token.
	async function verifySubscription() {
		if ((await tokenExpiresAt(childEnv.HOME)) - Date.now() < 5 * 60 * 1000) await run(['doctor'], '');
		await verifyUsage(childEnv.HOME);
	}
	const auth = JSON.parse(await run(['auth', 'status', '--json']));
	if (auth.loggedIn !== true || auth.authMethod !== 'claude.ai' || auth.apiProvider !== 'firstParty')
		throw new Error('Claude subscription authentication required.');
	// The CLI no longer reports the plan; verifySubscription checks it against the account profile.
	await verifySubscription();
	let busy = false;
	const server = http.createServer(async (req, res) => {
		const reply = (status, body) => {
			req.resume();
			return res
				.writeHead(status, {'content-type': 'application/json', 'cache-control': 'no-store'})
				.end(JSON.stringify(body));
		};
		if (req.method === 'GET' && req.url === '/contract')
			return reply(200, {hash: CONTRACT_HASH, merchantHash: MERCHANT_CONTRACT_HASH});
		const route = ROUTES.get(req.url);
		if (req.method !== 'POST' || !route) return reply(404, {error: 'not_found'});
		const {search, tools} = route;
		if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json')
			return reply(415, {error: 'unsupported_media_type'});
		if (req.headers['x-tempo-contract'] !== route.contractHash) return reply(409, {error: 'contract_mismatch'});
		if (busy) return reply(503, {error: 'claude_busy'});
		busy = true;
		const caller = new AbortController();
		res.on('close', () => {
			if (!res.writableFinished) caller.abort();
		});
		let result;
		// Set once the model calls a tool: a failure after that is the run's, not a refusal.
		let modelActed = false;
		try {
			const chunks = [];
			let bodyBytes = 0;
			for await (const chunk of req.iterator({destroyOnReturn: false})) {
				bodyBytes += chunk.length;
				if (bodyBytes > 1024 * 1024) return reply(413, {error: 'request_too_large'});
				chunks.push(chunk);
			}
			let parsed;
			try {
				parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
			} catch {
				return reply(400, {error: 'invalid_request'});
			}
			if (!route.valid(parsed)) return reply(400, {error: 'invalid_request'});
			const {input} = parsed;
			const query = search ? input.transactions[0].searchQuery : undefined;
			await verifySubscription();
			let initialized = false;
			let overageRejected = false;
			let searchId;
			let domains;
			await run(
				['-p', '--model', parsed.model, '--effort', parsed.effort, ...route.args],
				JSON.stringify(input),
				(event) => {
					if (event.type === 'system' && event.subtype === 'init') {
						if (
							initialized ||
							event.apiKeySource !== 'none' ||
							!Array.isArray(event.tools) ||
							event.tools.length !== tools.length ||
							!tools.every((tool) => event.tools.includes(tool)) ||
							!Array.isArray(event.mcp_servers) ||
							event.mcp_servers.length !== 0
						)
							throw new Error('Unsafe runtime.');
						initialized = true;
					}
					if (event.type === 'rate_limit_event') {
						const info = event.rate_limit_info;
						if (
							!['allowed', 'allowed_warning'].includes(info?.status) ||
							info.isUsingOverage !== false ||
							info.overageStatus !== 'rejected'
						)
							throw new Error('Usage prohibited.');
						overageRejected = true;
					}
					for (const item of Array.isArray(event.message?.content) ? event.message.content : []) {
						if (route.outputActs && event.type === 'assistant') modelActed = true;
						if (item.type === 'tool_use' && item.name !== 'StructuredOutput') {
							modelActed = true;
							// One search, with exactly the pinned query; the hook enforces the same before it runs.
							if (
								!search ||
								item.name !== 'WebSearch' ||
								searchId !== undefined ||
								item.input?.query !== query
							)
								throw new Error('Unexpected tool.');
							searchId = item.id ?? null;
						}
						if (item.type === 'tool_result' && searchId !== undefined && item.tool_use_id === searchId) {
							const output = event.tool_use_result;
							if (item.is_error || output?.query !== query || !Array.isArray(output.results) || domains)
								throw new Error('Search failed.');
							domains = sourceDomains(output.results);
						}
					}
					if (event.type === 'result') {
						if (!initialized || !overageRejected || result) throw new Error('Invalid result.');
						result = event;
					}
				},
				caller.signal,
				search ? {'search.json': JSON.stringify({query})} : {},
			);
			if (
				!result ||
				result.subtype !== 'success' ||
				result.is_error !== false ||
				!route.validOutput(result.structured_output, input) ||
				(search && !domains)
			)
				throw new Error('Invalid result.');
			reply(200, search ? {...result.structured_output, sourceDomains: domains} : result.structured_output);
		} catch {
			// 503: refused before the model acted (quota, overage, unsafe runtime), so the caller may retry. 502: the model
			// called a tool or returned a result, so a retry could search again or fail the same way.
			if (modelActed || result !== undefined) reply(502, {error: 'claude_failed'});
			else reply(503, {error: 'claude_unavailable'});
		} finally {
			busy = false;
		}
	});
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(socketPath, resolve);
	});
	await chmod(socketPath, 0o600);
	async function close() {
		closing = true;
		for (const kill of kills) kill();
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
		await Promise.allSettled([...operations]);
		await unlink(socketPath).catch(() => {});
	}
	return {socketPath, close};
}
