import {readFile} from 'node:fs/promises';
import {request as httpsRequest} from 'node:https';
import path from 'node:path';

// Expiry of the stored subscription login, or 0 when unreadable.
export async function storedTokenExpiresAt(home, {readCredentials = readFile} = {}) {
	try {
		const credentials = JSON.parse(await readCredentials(path.join(home, '.claude', '.credentials.json'), 'utf8'));
		const expiresAt = credentials.claudeAiOauth?.expiresAt;
		return typeof expiresAt === 'number' ? expiresAt : 0;
	} catch {
		return 0;
	}
}

// Claude Code's OAuth usage endpoint. Never send this token to the categorizer or caller.
export async function assertExtraUsageDisabled(
	home,
	{readCredentials = readFile, request = httpsRequest, timeoutMs = 10_000} = {},
) {
	try {
		const credentials = JSON.parse(await readCredentials(path.join(home, '.claude', '.credentials.json'), 'utf8'));
		const oauth = credentials.claudeAiOauth;
		if (
			!['max', 'pro'].includes(oauth?.subscriptionType) ||
			typeof oauth?.accessToken !== 'string' ||
			!oauth.accessToken
		)
			throw new Error();
		let timer;
		const usage = await new Promise((resolve, reject) => {
			const req = request(
				'https://api.anthropic.com/api/oauth/usage',
				{
					method: 'GET',
					agent: false,
					headers: {
						Authorization: `Bearer ${oauth.accessToken}`,
						'anthropic-beta': 'oauth-2025-04-20',
						Accept: 'application/json',
					},
				},
				(res) => {
					if (res.statusCode !== 200) {
						res.destroy();
						req.destroy(new Error());
						return;
					}
					let body = '';
					let bytes = 0;
					res.on('data', (chunk) => {
						bytes += Buffer.byteLength(chunk);
						if (bytes > 64 * 1024) {
							res.destroy();
							req.destroy(new Error());
							return;
						}
						body += chunk;
					});
					res.on('error', reject);
					res.on('end', () => {
						try {
							resolve(JSON.parse(body));
						} catch {
							reject(new Error());
						}
					});
				},
			);
			timer = setTimeout(() => {
				req.destroy();
				reject(new Error());
			}, timeoutMs);
			req.on('error', reject);
			req.end();
		}).finally(() => clearTimeout(timer));
		if (usage?.extra_usage?.is_enabled !== false) throw new Error();
	} catch {
		throw new Error('Cannot verify Claude extra usage is disabled.');
	}
}
