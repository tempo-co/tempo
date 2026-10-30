import {randomUUID} from 'node:crypto';
import {Server} from 'node:net';
import request from 'supertest';

import {ConfigurationService} from '@core/config/config.service';
import {
	PASSWORD_RESET_CONFIRMATION,
	PASSWORD_RESET_INVALID_TOKEN,
	PASSWORD_RESET_SUCCESS,
	PASSWORD_SAME_AS_OLD,
} from '@modules/auth/api/constants/api-messages.constants';
import {PasswordResetVerifyDto} from '@modules/auth/api/dtos/password-reset-verify.dto';

import {PW_RESET_ACCOUNT_EMAIL, PW_RESET_ACCOUNT_PASSWORD} from '../../../scripts/seed-data/seed.constants';
import {getApp, loginAgent} from '../../setup/e2e.setup';
import {UUID_VALIDATION_REGEX} from '../../types/regex.constants';
import {expectValidationMessage, uniqueEmail, uniquePassword} from '../../utils/auth-utils';
import {EmailUtils} from '../../utils/email-utils';

describe('AuthController - Reset Password', () => {
	let mailpitApiUrl: string;
	let passwordResetExpiration: string;
	let webUrl: string;
	let httpServer: Server;
	// Successful resets change the seeded account's password; track it so later tests can log in.
	let currentPassword = PW_RESET_ACCOUNT_PASSWORD;

	beforeAll(async () => {
		const app = getApp();
		const config = app.get(ConfigurationService);
		mailpitApiUrl = config.get('EMAIL_UI_URL');
		passwordResetExpiration = config.get('PASSWORD_RESET_EXPIRATION');
		webUrl = config.get('WEB_BASE_URL');
		httpServer = app.getHttpServer();
	});

	beforeEach(async () => {
		await EmailUtils.clearEmails(mailpitApiUrl);
	});

	function requestReset(email: string) {
		return request(httpServer).post('/auth/reset-password/request').send({email});
	}

	function verifyReset(body: Partial<PasswordResetVerifyDto>) {
		return request(httpServer).post('/auth/reset-password/verify').send(body);
	}

	function login(password: string) {
		return request(httpServer).post('/auth/login').send({email: PW_RESET_ACCOUNT_EMAIL, password});
	}

	describe('POST /auth/reset-password/request', () => {
		it('should send a password reset email for an existing account', async () => {
			const response = await requestReset(PW_RESET_ACCOUNT_EMAIL).expect(200);
			expect(response.body.message).toBe(PASSWORD_RESET_CONFIRMATION);

			const resetEmail = await EmailUtils.findEmailByRecipient(PW_RESET_ACCOUNT_EMAIL, mailpitApiUrl);
			const body = EmailUtils.normalizeEmailText(resetEmail?.Text);
			const token = EmailUtils.extractToken(body);

			expect(resetEmail?.To[0].Address).toEqual(PW_RESET_ACCOUNT_EMAIL);
			expect(token).toMatch(UUID_VALIDATION_REGEX);
			expect(resetEmail?.Subject).toBe('Reset your Tempo password');
			expect(body).toBe(
				EmailUtils.getPasswordResetEmailBody(PW_RESET_ACCOUNT_EMAIL, webUrl, token, passwordResetExpiration),
			);
		});

		it('should return confirmation even if the email does not exist', async () => {
			const nonExistentEmail = uniqueEmail();

			const response = await requestReset(nonExistentEmail).expect(200);
			expect(response.body.message).toBe(PASSWORD_RESET_CONFIRMATION);

			expect(await EmailUtils.findEmailByRecipient(nonExistentEmail, mailpitApiUrl)).toBeUndefined();
		});

		it.each([
			['email format is invalid', {email: 'not-a-valid-email'}, /email must be an email/i],
			['email is missing', {}, /email should not be empty/i],
		])('should fail with 400 Bad Request if %s', async (_case, body, message) => {
			const response = await request(httpServer).post('/auth/reset-password/request').send(body).expect(400);
			expectValidationMessage(response, message);
		});
	});

	describe('POST /auth/reset-password/verify', () => {
		let resetToken: string;

		beforeEach(async () => {
			await requestReset(PW_RESET_ACCOUNT_EMAIL).expect(200);
			resetToken = await EmailUtils.getToken(PW_RESET_ACCOUNT_EMAIL, mailpitApiUrl);
		});

		it('should fail with 400 Bad Request if new password is the same as the old password', async () => {
			const response = await verifyReset({token: resetToken, newPassword: currentPassword}).expect(400);
			expect(response.body.message).toBe(PASSWORD_SAME_AS_OLD);

			await login(currentPassword).expect(200);
		});

		it('resets the password and revokes personal access tokens with a valid reset token', async () => {
			const agent = await loginAgent(httpServer, PW_RESET_ACCOUNT_EMAIL, currentPassword);
			const {body: pat} = await agent
				.post('/personal-access-tokens')
				.set('Origin', 'http://localhost:5173')
				.send({name: 'Example reset client'})
				.expect(201);
			const newPassword = uniquePassword();

			const response = await verifyReset({token: resetToken, newPassword}).expect(200);
			expect(response.body.message).toBe(PASSWORD_RESET_SUCCESS);
			await request(httpServer).get('/bank-transactions').auth(pat.token, {type: 'bearer'}).expect(401);

			await login(currentPassword).expect(401);
			await login(newPassword).expect(200);
			currentPassword = newPassword;
		});

		it('should fail with 400 Bad Request for a non-existent token', async () => {
			const response = await verifyReset({
				token: randomUUID(),
				newPassword: uniquePassword(),
			}).expect(400);
			expect(response.body.message).toBe(PASSWORD_RESET_INVALID_TOKEN);
		});

		it('should fail with 400 Bad Request if the token has already been used', async () => {
			const verifyDto = {token: resetToken, newPassword: uniquePassword()};

			await verifyReset(verifyDto).expect(200);
			currentPassword = verifyDto.newPassword;

			const response = await verifyReset(verifyDto).expect(400);
			expect(response.body.message).toBe(PASSWORD_RESET_INVALID_TOKEN);
		});

		it.each<[string, (token: string) => Partial<PasswordResetVerifyDto>, RegExp]>([
			[
				'new password is too short',
				(token) => ({token, newPassword: 'short'}),
				/newPassword must be longer than or equal to 8 characters/i,
			],
			[
				'new password exceeds maximum length (255)',
				(token) => ({token, newPassword: 'a'.repeat(256)}),
				/newPassword must be shorter than or equal to 255 characters/i,
			],
			['token is missing', () => ({newPassword: uniquePassword()}), /token should not be empty/i],
			['newPassword is missing', (token) => ({token}), /newPassword should not be empty/i],
		])('should fail with 400 Bad Request if %s', async (_case, buildBody, message) => {
			const response = await verifyReset(buildBody(resetToken)).expect(400);
			expectValidationMessage(response, message);
		});
	});
});
