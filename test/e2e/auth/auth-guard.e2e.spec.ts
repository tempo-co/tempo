import {randomUUID} from 'node:crypto';
import {Server} from 'node:net';
import request from 'supertest';
import TestAgent from 'supertest/lib/agent';
import {DataSource} from 'typeorm';

import {PersonalAccessTokenService} from '@core/personal-access-token/personal-access-token.service';
import {Account} from '@modules/account/account.entity';
import {EMAIL_NOT_VERIFIED} from '@modules/auth/api/constants/api-messages.constants';

import {
	UNVERIFIED_ACCOUNT_EMAIL,
	UNVERIFIED_ACCOUNT_PASSWORD,
	VERIFIED_ACCOUNT_EMAIL,
	VERIFIED_ACCOUNT_PASSWORD,
} from '../../../scripts/seed-data/seed.constants';
import {getApp, loginAgent} from '../../setup/e2e.setup';

type Method = 'get' | 'post' | 'patch' | 'delete' | 'head';
type GuardedRoute = [method: Method, path: string];

const SESSION_ID = 'a'.repeat(32);
const RESOURCE_ID = randomUUID();
const SERIES_KEY = 'b'.repeat(32);
const MCP_TOKEN_ROUTES: GuardedRoute[] = [
	['post', '/mcp'],
	['get', '/mcp'],
	['delete', '/mcp'],
	['head', '/mcp'],
];

// Routes that accept unverified accounts (@SkipEmailVerification) only require a session.
const SESSION_ROUTES: GuardedRoute[] = [
	['post', '/auth/logout'],
	['post', '/auth/signup/resend'],
	['get', '/accounts/me'],
];

// Read routes a verified session or a personal access token may use.
const TOKEN_READABLE_PATHS = [
	'/bank-connections',
	'/bank-transactions',
	'/bank-transactions/totals',
	'/bank-transactions/summary?month=2026-10&asOf=2026-10-18',
	'/bank-transactions/cash-flow?interval=month&from=2026-01-01&to=2026-10-18&asOf=2026-10-18',
	'/bank-transactions/balance-trend?interval=month&from=2026-01-01&to=2026-10-18&asOf=2026-10-18',
	'/bank-transactions/review-counts',
	'/recurring-series?asOf=2026-10-18',
	'/recurring-series/summary?asOf=2026-10-18',
	`/bank-transactions/${RESOURCE_ID}`,
];

// Routes that require a session for an account with a verified email; personal tokens are refused.
const VERIFIED_SESSION_ONLY_ROUTES: GuardedRoute[] = [
	['head', '/auth/change-email/check?email=available%40example.test'],
	['post', '/auth/change-email/request'],
	['post', '/auth/change-email/verify'],
	['post', '/auth/change-password'],
	['get', '/auth/sessions'],
	['delete', '/auth/sessions'],
	['delete', `/auth/sessions/${SESSION_ID}`],
	['patch', '/accounts/me'],
	['delete', '/accounts/me'],
	['get', '/personal-access-tokens'],
	['post', '/personal-access-tokens'],
	['delete', `/personal-access-tokens/${RESOURCE_ID}`],
	['get', `/bank-transactions/${RESOURCE_ID}/category-impact?category=TRAVEL`],
	['patch', `/bank-transactions/${RESOURCE_ID}/category`],
	['patch', `/bank-transactions/${RESOURCE_ID}/own-transfer`],
	['patch', `/recurring-series/${SERIES_KEY}/hidden`],
	['patch', `/recurring-series/${SERIES_KEY}/continuation`],
	['post', '/bank-connections/authorize'],
	['post', `/bank-connections/${RESOURCE_ID}/refresh`],
	['get', '/bank-connections/aspsps'],
	['delete', `/bank-connections/${RESOURCE_ID}`],
	['get', `/bank-connections/${RESOURCE_ID}/transactions`],
];

const VERIFIED_ROUTES: GuardedRoute[] = [
	...TOKEN_READABLE_PATHS.map((path): GuardedRoute => ['get', path]),
	...VERIFIED_SESSION_ONLY_ROUTES,
];
const TOKEN_DENIED_ROUTES: GuardedRoute[] = [
	...SESSION_ROUTES,
	...VERIFIED_SESSION_ONLY_ROUTES,
	['get', '/bank-connections/callback'],
	['get', '/health'],
	['head', '/bank-transactions'],
	['post', '/auth/login'],
	['post', '/auth/signup'],
	['post', '/auth/signup/verify'],
	['post', '/auth/reset-password/request'],
	['post', '/auth/reset-password/verify'],
];

// HEAD requests cannot carry a body, and their responses omit it.
function send(test: request.Test, method: Method) {
	return method === 'head' ? test : test.send({});
}

describe('AuthGuard - protected routes', () => {
	let httpServer: Server;
	let unverifiedAgent: TestAgent;
	let token: string;
	let unverifiedToken: string;

	beforeAll(async () => {
		httpServer = getApp().getHttpServer();
		unverifiedAgent = await loginAgent(httpServer, UNVERIFIED_ACCOUNT_EMAIL, UNVERIFIED_ACCOUNT_PASSWORD);
		const agent = await loginAgent(httpServer, VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);
		token = (
			await agent
				.post('/personal-access-tokens')
				.set('Origin', 'http://localhost:5173')
				.send({name: 'Example route guard client'})
				.expect(201)
		).body.token;
		const unverified = await getApp()
			.get(DataSource)
			.getRepository(Account)
			.findOneByOrFail({email: UNVERIFIED_ACCOUNT_EMAIL});
		unverifiedToken = (
			await getApp().get(PersonalAccessTokenService).create(unverified.id, 'Example unverified client', 30)
		).token;
	});

	it.each(MCP_TOKEN_ROUTES)('%s %s permits a verified personal token', async (method, path) => {
		await send(
			request(httpServer)
				[method](path)
				.auth(token, {type: 'bearer'})
				.set('Accept', 'application/json, text/event-stream'),
			method,
		).expect(method === 'post' ? 400 : 405);
	});

	it.each(MCP_TOKEN_ROUTES)('%s %s requires a verified token owner', async (method, path) => {
		const response = await send(
			request(httpServer)[method](path).auth(unverifiedToken, {type: 'bearer'}),
			method,
		).expect(403);
		if (method !== 'head') expect(response.body.message).toBe(EMAIL_NOT_VERIFIED);
		expect(response.headers['set-cookie']).toBeUndefined();
	});

	it.each(TOKEN_READABLE_PATHS)('%s accepts a read-only personal token', async (path) => {
		await request(httpServer)
			.get(path)
			.auth(token, {type: 'bearer'})
			.expect(path === `/bank-transactions/${RESOURCE_ID}` ? 404 : 200);
	});

	it.each(TOKEN_DENIED_ROUTES)('%s %s rejects a valid personal token with 403', async (method, path) => {
		const response = await send(request(httpServer)[method](path).auth(token, {type: 'bearer'}), method).expect(
			403,
		);
		expect(response.headers['set-cookie']).toBeUndefined();
	});

	it.each(TOKEN_DENIED_ROUTES)('%s %s rejects an invalid personal token with 401', async (method, path) => {
		await send(request(httpServer)[method](path).auth('tempo_pat_invalid', {type: 'bearer'}), method).expect(401);
	});

	it.each([...SESSION_ROUTES, ...VERIFIED_ROUTES, ...MCP_TOKEN_ROUTES])(
		'%s %s rejects an unauthenticated request with 401',
		async (method, path) => {
			const response = await send(request(httpServer)[method](path), method).expect(401);
			if (method !== 'head') expect(response.body.message).toBe('Unauthorized');
			if (path === '/mcp') expect(response.headers['www-authenticate']).toBe('Bearer');
		},
	);

	it.each(VERIFIED_ROUTES)('%s %s rejects an unverified account with 403', async (method, path) => {
		const response = await send(unverifiedAgent[method](path), method).expect(403);
		if (method !== 'head') expect(response.body.message).toBe(EMAIL_NOT_VERIFIED);
	});
});
