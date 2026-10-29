import {faker} from '@faker-js/faker';
import {Server} from 'node:net';
import request from 'supertest';

import {INVALID_PASSWORD, PASSWORD_CHANGE_SUCCESS} from '@modules/auth/api/constants/api-messages.constants';
import {PasswordChangeDto} from '@modules/auth/api/dtos/password-change.dto';

import {
	PW_CHANGE_ACCOUNT_EMAIL,
	PW_CHANGE_ACCOUNT_PASSWORD,
	VERIFIED_ACCOUNT_EMAIL,
	VERIFIED_ACCOUNT_PASSWORD,
} from '../../../scripts/seed-data/seed.constants';
import {getApp, loginAgent} from '../../setup/e2e.setup';
import {expectValidationMessage} from '../../utils/auth-utils';

describe('AuthController - Change password', () => {
	let httpServer: Server;

	beforeAll(() => {
		httpServer = getApp().getHttpServer();
	});

	describe('POST /auth/change-password', () => {
		it('should change password, revoke other sessions, and allow login with new password', async () => {
			const agent = await loginAgent(httpServer, PW_CHANGE_ACCOUNT_EMAIL, PW_CHANGE_ACCOUNT_PASSWORD);
			const otherAgent = await loginAgent(httpServer, PW_CHANGE_ACCOUNT_EMAIL, PW_CHANGE_ACCOUNT_PASSWORD);
			const {body: pat} = await agent
				.post('/personal-access-tokens')
				.set('Origin', 'http://localhost:5173')
				.send({name: 'Example password client'})
				.expect(201);

			const newPassword = faker.internet.password({length: 12});
			const changePasswordDto: PasswordChangeDto = {
				currentPassword: PW_CHANGE_ACCOUNT_PASSWORD,
				newPassword: newPassword,
			};

			await agent
				.post('/auth/change-password')
				.send(changePasswordDto)
				.expect(200)
				.expect((res) => {
					expect(res.body.message).toEqual(PASSWORD_CHANGE_SUCCESS);
				});

			await request(httpServer).get('/bank-transactions').auth(pat.token, {type: 'bearer'}).expect(401);
			await agent.get('/accounts/me').expect(200);
			await otherAgent.get('/accounts/me').expect(401);
			await agent.post('/auth/logout').expect(200);

			// Old password fails login
			await request(httpServer)
				.post('/auth/login')
				.send({email: PW_CHANGE_ACCOUNT_EMAIL, password: PW_CHANGE_ACCOUNT_PASSWORD})
				.expect(401);

			// New password succeeds login
			await request(httpServer)
				.post('/auth/login')
				.send({email: PW_CHANGE_ACCOUNT_EMAIL, password: newPassword})
				.expect(200);
		});

		it('should fail with 401 Unauthorized if current password is incorrect', async () => {
			const agent = await loginAgent(httpServer, VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);
			const otherAgent = await loginAgent(httpServer, VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);

			const changePasswordDto: PasswordChangeDto = {
				currentPassword: 'wrong-current-password',
				newPassword: faker.internet.password({length: 12}),
			};

			const response = await agent.post('/auth/change-password').send(changePasswordDto).expect(401);
			expect(response.body.message).toBe(INVALID_PASSWORD);
			await agent.get('/accounts/me').expect(200);
			await otherAgent.get('/accounts/me').expect(200);
		});

		it.each([
			[
				'new password is too short',
				{currentPassword: VERIFIED_ACCOUNT_PASSWORD, newPassword: 'short'},
				/newPassword must be longer than or equal to 8 characters/i,
			],
			[
				'current password is missing',
				{newPassword: faker.internet.password({length: 12})},
				/currentPassword should not be empty/i,
			],
			[
				'new password is missing',
				{currentPassword: VERIFIED_ACCOUNT_PASSWORD},
				/newPassword should not be empty/i,
			],
		])('should fail with 400 Bad Request if %s', async (_case, body: Partial<PasswordChangeDto>, message) => {
			const agent = await loginAgent(httpServer, VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);

			const response = await agent.post('/auth/change-password').send(body).expect(400);
			expectValidationMessage(response, message);
		});
	});
});
