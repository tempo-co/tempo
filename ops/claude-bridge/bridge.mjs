import {spawn} from 'node:child_process';
import {chmod, lstat, mkdir, mkdtemp, realpath, rm, unlink} from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

import contract from './contract.json' with {type: 'json'};
import {assertExtraUsageDisabled, storedTokenExpiresAt} from './subscription.mjs';
import {validRequest, validResponse} from './validation.mjs';

const CLI_ARGS = [
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
];

export async function startBridge({
	socketPath,
	claudePath = 'claude',
	spawnProcess = spawn,
	env = process.env,
	verifyUsage = assertExtraUsageDisabled,
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
	async function runChild(args, input, onEvent, signal) {
		const cwd = await mkdtemp(path.join(directory, 'request-'));
		try {
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
	// usage check, which refuses an expired token.
	async function verifySubscription() {
		if ((await tokenExpiresAt(childEnv.HOME)) - Date.now() < 5 * 60 * 1000) await run(['doctor'], '');
		await verifyUsage(childEnv.HOME);
	}
	const auth = JSON.parse(await run(['auth', 'status', '--json']));
	if (
		auth.loggedIn !== true ||
		auth.authMethod !== 'claude.ai' ||
		auth.apiProvider !== 'firstParty' ||
		!['max', 'pro'].includes(auth.subscriptionType)
	)
		throw new Error('Claude subscription authentication required.');
	await verifySubscription();
	let busy = false;
	const server = http.createServer(async (req, res) => {
		const reply = (status, body) => {
			req.resume();
			return res
				.writeHead(status, {'content-type': 'application/json', 'cache-control': 'no-store'})
				.end(JSON.stringify(body));
		};
		if (req.method !== 'POST' || req.url !== '/categorize') return reply(404, {error: 'not_found'});
		if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json')
			return reply(415, {error: 'unsupported_media_type'});
		if (busy) return reply(503, {error: 'claude_busy'});
		busy = true;
		const caller = new AbortController();
		res.on('close', () => {
			if (!res.writableFinished) caller.abort();
		});
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
			if (!validRequest(parsed)) return reply(400, {error: 'invalid_request'});
			const {input} = parsed;
			await verifySubscription();
			let initialized = false;
			let overageRejected = false;
			let result;
			await run(
				CLI_ARGS,
				JSON.stringify(input),
				(event) => {
					if (event.type === 'system' && event.subtype === 'init') {
						if (
							initialized ||
							event.apiKeySource !== 'none' ||
							!Array.isArray(event.tools) ||
							event.tools.length !== 1 ||
							event.tools[0] !== 'StructuredOutput' ||
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
					if (
						Array.isArray(event.message?.content) &&
						event.message.content.some(
							(item) => item.type === 'tool_use' && item.name !== 'StructuredOutput',
						)
					)
						throw new Error('Unexpected tool.');
					if (event.type === 'result') {
						if (!initialized || !overageRejected || result) throw new Error('Invalid result.');
						result = event;
					}
				},
				caller.signal,
			);
			if (
				!result ||
				result.subtype !== 'success' ||
				result.is_error !== false ||
				!validResponse(result.structured_output, input)
			)
				throw new Error('Invalid result.');
			reply(200, result.structured_output);
		} catch {
			reply(503, {error: 'claude_unavailable'});
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
