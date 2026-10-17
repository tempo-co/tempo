import {execFile} from 'node:child_process';
import http from 'node:http';
import {homedir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {promisify} from 'node:util';

const run = promisify(execFile);
const hashPattern = /^[a-f0-9]{64}$/;
const apiHashCommand = `const {createHash} = require('node:crypto');
const contract = require('./dist/ops/claude-bridge/contract.json');
process.stdout.write(createHash('sha256').update(JSON.stringify(contract)).digest('hex'));`;

async function readProductionApiHash() {
	const {stdout} = await run(
		'docker',
		['exec', process.env.TEMPO_API_CONTAINER ?? 'tempo-api-production-api-1', 'node', '-e', apiHashCommand],
		{timeout: 5000, maxBuffer: 4096},
	);
	return stdout;
}

function readBridgeHash(socketPath) {
	return new Promise((resolve, reject) => {
		const request = http.get({socketPath, path: '/contract', signal: AbortSignal.timeout(5000)}, (response) => {
			let body = '';
			response.setEncoding('utf8');
			response.on('error', reject);
			response.on('data', (chunk) => {
				body += chunk;
				if (body.length > 4096) {
					reject(new Error('Response limit.'));
					response.destroy();
				}
			});
			response.on('end', () => {
				try {
					if (response.statusCode !== 200) throw new Error('Bridge unavailable.');
					resolve(JSON.parse(body).hash);
				} catch (error) {
					reject(error);
				}
			});
		});
		request.on('error', reject);
	});
}

/** Silent when healthy; a safe reason otherwise, for the host uptime probe's existing alert/deduplication path. */
export async function checkContract({
	socketPath = process.env.TEMPO_CLAUDE_BRIDGE_SOCKET ??
		path.join(homedir(), '.local/state/tempo-claude/bridge.sock'),
	readApiHash = readProductionApiHash,
} = {}) {
	try {
		const apiHash = await readApiHash();
		const bridgeHash = await readBridgeHash(socketPath);
		if (!hashPattern.test(apiHash) || !hashPattern.test(bridgeHash)) throw new Error('Invalid contract hash.');
		return apiHash === bridgeHash
			? ''
			: 'Claude fallback contract differs from the running API; reinstall and restart the bridge.';
	} catch {
		return 'Claude fallback contract check failed; bridge or API unavailable.';
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const failure = await checkContract();
	if (failure) {
		console.log(failure);
		process.exitCode = 1;
	}
}
