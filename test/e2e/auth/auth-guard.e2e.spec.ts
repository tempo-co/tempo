import {randomUUID} from 'node:crypto';
import {Server} from 'node:net';
import request from 'supertest';
import TestAgent from 'supertest/lib/agent';

import {EMAIL_NOT_VERIFIED} from '@modules/auth/api/constants/api-messages.constants';

import {UNVERIFIED_ACCOUNT_EMAIL, UNVERIFIED_ACCOUNT_PASSWORD} from '../../../scripts/seed-data/seed.constants';
import {getApp, loginAgent} from '../../setup/e2e.setup';

type Method = 'get' | 'post' | 'patch' | 'delete' | 'head';
type GuardedRoute = [method: Method, path: string];

const SESSION_ID = 'a'.repeat(32);
const RESOURCE_ID = randomUUID();
const SERIES_KEY = 'b'.repeat(32);

// Routes that accept unverified accounts (@SkipEmailVerification) only require a session.
const SESSION_ROUTES: GuardedRoute[] = [
	['post', '/auth/logout'],
	['post', '/auth/signup/resend'],
	['get', '/accounts/me'],
];

// Routes that require a session for an account with a verified email.
const VERIFIED_ROUTES: GuardedRoute[] = [
	['head', '/auth/change-email/check?email=available%40example.test'],
	['post', '/auth/change-email/request'],
	['post', '/auth/change-email/verify'],
	['post', '/auth/change-password'],
	['get', '/auth/sessions'],
	['delete', '/auth/sessions'],
	['delete', `/auth/sessions/${SESSION_ID}`],
	['patch', '/accounts/me'],
	['delete', '/accounts/me'],
	['get', '/bank-transactions'],
	['get', '/bank-transactions/summary?month=2026-10&asOf=2026-10-18'],
	['get', '/bank-transactions/cash-flow?interval=month&from=2026-01-01&to=2026-10-18'],
	['get', '/bank-transactions/balance-trend?interval=month&from=2026-01-01&to=2026-10-18&asOf=2026-10-18'],
	['get', '/bank-transactions/review-counts'],
	['get', `/bank-transactions/${RESOURCE_ID}`],
	['get', `/bank-transactions/${RESOURCE_ID}/category-impact?category=TRAVEL`],
	['patch', `/bank-transactions/${RESOURCE_ID}/category`],
	['patch', `/bank-transactions/${RESOURCE_ID}/own-transfer`],
	['get', '/recurring-series?asOf=2026-10-18'],
	['patch', `/recurring-series/${SERIES_KEY}/hidden`],
	['patch', `/recurring-series/${SERIES_KEY}/continuation`],
	['post', '/bank-connections/authorize'],
	['get', '/bank-connections/aspsps'],
	['get', '/bank-connections'],
	['delete', `/bank-connections/${RESOURCE_ID}`],
	['get', `/bank-connections/${RESOURCE_ID}/transactions`],
];

// HEAD requests cannot carry a body, and their responses omit it.
function send(test: request.Test, method: Method) {
	return method === 'head' ? test : test.send({});
}

describe('AuthGuard - protected routes', () => {
	let httpServer: Server;
	let unverifiedAgent: TestAgent;

	beforeAll(async () => {
		httpServer = getApp().getHttpServer();
		unverifiedAgent = await loginAgent(httpServer, UNVERIFIED_ACCOUNT_EMAIL, UNVERIFIED_ACCOUNT_PASSWORD);
	});

	it.each([...SESSION_ROUTES, ...VERIFIED_ROUTES])(
		'%s %s rejects an unauthenticated request with 401',
		async (method, path) => {
			const response = await send(request(httpServer)[method](path), method).expect(401);
			if (method !== 'head') expect(response.body.message).toBe('Unauthorized');
		},
	);

	it.each(VERIFIED_ROUTES)('%s %s rejects an unverified account with 403', async (method, path) => {
		const response = await send(unverifiedAgent[method](path), method).expect(403);
		if (method !== 'head') expect(response.body.message).toBe(EMAIL_NOT_VERIFIED);
	});
});
