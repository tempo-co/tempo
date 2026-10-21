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

const PROFILE_URL = 'https://api.anthropic.com/api/oauth/profile';
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

// Requires a Max or Pro plan with extra usage off, via Claude Code's OAuth endpoints. Never send this token to the
// categorizer or caller. The plan comes from the profile because refreshed logins no longer store it locally.
export async function assertSubscriptionUsable(
	home,
	{readCredentials = readFile, request = httpsRequest, timeoutMs = 10_000} = {},
) {
	try {
		const credentials = JSON.parse(await readCredentials(path.join(home, '.claude', '.credentials.json'), 'utf8'));
		const oauth = credentials.claudeAiOauth;
		if (typeof oauth?.accessToken !== 'string' || !oauth.accessToken) throw new Error();
		const profile = await getJson(request, PROFILE_URL, oauth.accessToken, timeoutMs);
		if (!['claude_max', 'claude_pro'].includes(profile?.organization?.organization_type)) throw new Error();
		const usage = await getJson(request, USAGE_URL, oauth.accessToken, timeoutMs);
		if (usage?.extra_usage?.is_enabled !== false) throw new Error();
	} catch {
		throw new Error('Cannot verify the Claude subscription is usable.');
	}
}

function getJson(request, url, accessToken, timeoutMs) {
	let timer;
	return new Promise((resolve, reject) => {
		const req = request(
			url,
			{
				method: 'GET',
				agent: false,
				headers: {
					Authorization: `Bearer ${accessToken}`,
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
}
