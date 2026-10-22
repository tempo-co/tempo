import {readFile} from 'node:fs/promises';
import {request as httpsRequest} from 'node:https';
import path from 'node:path';

// The stored subscription login, or undefined when unreadable.
async function readLogin(home, readCredentials) {
	try {
		return JSON.parse(await readCredentials(path.join(home, '.claude', '.credentials.json'), 'utf8')).claudeAiOauth;
	} catch {
		return undefined;
	}
}

// Expiry of the stored subscription login, or 0 when unreadable.
export async function storedTokenExpiresAt(home, {readCredentials = readFile} = {}) {
	const expiresAt = (await readLogin(home, readCredentials))?.expiresAt;
	return typeof expiresAt === 'number' ? expiresAt : 0;
}

const PROFILE_URL = 'https://api.anthropic.com/api/oauth/profile';
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
// The OAuth endpoints rate-limit bursts, and a backfill checks before every call, so the bridge reuses a pass for the
// same unexpired login and rides out a 429 shortly after one. Each run's own rate-limit event still has to show
// overage refused, so no run completes on paid usage.
const PASS_REUSED_FOR_MS = 5 * 60 * 1000;
const PASS_REUSED_WHILE_RATE_LIMITED_FOR_MS = 15 * 60 * 1000;

export function createSubscriptionCheck({readCredentials = readFile, now = Date.now, ...options} = {}) {
	let pass;
	return async (home) => {
		const login = await readLogin(home, readCredentials);
		const t = now();
		const unexpired = typeof login?.expiresAt === 'number' && login.expiresAt > t;
		const age = unexpired && pass?.token === login.accessToken ? t - pass.at : Infinity;
		if (age < PASS_REUSED_FOR_MS) return;
		try {
			await verifyLogin(login, options);
		} catch (error) {
			if (error.rateLimited && age < PASS_REUSED_WHILE_RATE_LIMITED_FOR_MS) return;
			pass = undefined;
			throw error;
		}
		pass = {token: login.accessToken, at: t};
	};
}

// Requires a Max or Pro plan with extra usage off, via Claude Code's OAuth endpoints. Never send this token to the
// categorizer or caller. The plan comes from the profile because refreshed logins no longer store it locally.
export async function assertSubscriptionUsable(home, {readCredentials = readFile, ...options} = {}) {
	await verifyLogin(await readLogin(home, readCredentials), options);
}

async function verifyLogin(oauth, {request = httpsRequest, timeoutMs = 10_000} = {}) {
	try {
		if (typeof oauth?.accessToken !== 'string' || !oauth.accessToken) throw new Error();
		const profile = await getJson(request, PROFILE_URL, oauth.accessToken, timeoutMs);
		if (!['claude_max', 'claude_pro'].includes(profile?.organization?.organization_type)) throw new Error();
		const usage = await getJson(request, USAGE_URL, oauth.accessToken, timeoutMs);
		if (usage?.extra_usage?.is_enabled !== false) throw new Error();
	} catch (error) {
		// A caller may ride out only a 429.
		throw Object.assign(new Error('Cannot verify the Claude subscription is usable.'), {
			rateLimited: error?.status === 429,
		});
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
					req.destroy(Object.assign(new Error(), {status: res.statusCode}));
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
