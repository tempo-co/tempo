import {Server} from 'node:net';
import request from 'supertest';

import {Account} from '@modules/account/account.entity';
import {INVALID_CREDENTIALS} from '@modules/auth/api/constants/api-messages.constants';

import {
	VERIFIED_ACCOUNT_EMAIL,
	VERIFIED_ACCOUNT_NAME,
	VERIFIED_ACCOUNT_PASSWORD,
} from '../../../scripts/seed-data/seed.constants';
import {getApp, getSessionCookie, loginAgent} from '../../setup/e2e.setup';
import {expectValidationMessage} from '../../utils/auth-utils';

describe('AuthController - Login', () => {
	let httpServer: Server;

	beforeAll(async () => {
		httpServer = getApp().getHttpServer();
	});

	describe('POST /auth/login', () => {
		it('should log in with correct credentials and establish session', async () => {
			const agent = await loginAgent(httpServer, VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);
			const response = await agent.get('/accounts/me').expect(200);

			const account: Account = response.body;
			expect(account.id).toBeDefined();
			expect(account.email).toEqual(VERIFIED_ACCOUNT_EMAIL);
			expect(account.name).toEqual(VERIFIED_ACCOUNT_NAME);
			expect(account.password).toBeUndefined();

			const sessionCookie = getSessionCookie(response);
			expect(sessionCookie).toMatch(/HttpOnly/);
			expect(sessionCookie).toMatch(/Path=\//);
			expect(sessionCookie).toMatch(/SameSite=Strict/);
			expect(sessionCookie).toMatch(/Expires=/);
		});

		it('should log in regardless of email casing and surrounding whitespace', async () => {
			await loginAgent(httpServer, ` ${VERIFIED_ACCOUNT_EMAIL.toUpperCase()} `, VERIFIED_ACCOUNT_PASSWORD);
		});

		it.each([
			['an incorrect password', {email: VERIFIED_ACCOUNT_EMAIL, password: 'incorrect-password'}],
			['an unknown email', {email: 'incorrect@email.com', password: VERIFIED_ACCOUNT_PASSWORD}],
		])('should fail to log in with %s without setting a session', async (_case, credentials) => {
			const response = await request(httpServer).post('/auth/login').send(credentials).expect(401);
			expect(response.body.message).toBe(INVALID_CREDENTIALS);
			expect(response.headers['set-cookie']).toBeUndefined();
		});

		it.each([
			['email is missing', {password: 'password123'}],
			['email is empty', {email: '', password: 'password123'}],
			['password is missing', {email: VERIFIED_ACCOUNT_EMAIL}],
			['password is empty', {email: VERIFIED_ACCOUNT_EMAIL, password: ''}],
		])('should fail with 401 Unauthorized if %s', async (_case, body) => {
			await request(httpServer).post('/auth/login').send(body).expect(401);
		});

		it.each([
			[
				'email is not a valid email format',
				{email: 'not-a-valid-email', password: 'password123'},
				/email must be an email/i,
			],
			[
				'password is too short',
				{email: VERIFIED_ACCOUNT_EMAIL, password: '123'},
				/password must be longer than or equal to 8 characters/i,
			],
		])('should fail with 400 Bad Request if %s', async (_case, body, message) => {
			const response = await request(httpServer).post('/auth/login').send(body).expect(400);
			expectValidationMessage(response, message);
		});
	});
});
