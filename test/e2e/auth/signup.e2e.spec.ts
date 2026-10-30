import {Server} from 'node:net';
import request from 'supertest';
import TestAgent from 'supertest/lib/agent';

import {ConfigurationService} from '@core/config/config.service';
import {
	EMAIL_ALREADY_IN_USE,
	EMAIL_ALREADY_VERIFIED,
	EMAIL_INVALID_TOKEN,
	EMAIL_VERIFICATION_SENT,
	EMAIL_VERIFICATION_SUCCESS,
} from '@modules/auth/api/constants/api-messages.constants';
import {SignUpDto} from '@modules/auth/api/dtos/signup.dto';

import {
	UNVERIFIED_ACCOUNT_EMAIL,
	UNVERIFIED_ACCOUNT_NAME,
	UNVERIFIED_ACCOUNT_PASSWORD,
	VERIFIED_ACCOUNT_EMAIL,
	VERIFIED_ACCOUNT_PASSWORD,
} from '../../../scripts/seed-data/seed.constants';
import {getApp, getSessionCookie, loginAgent} from '../../setup/e2e.setup';
import {createAccountCredentials, expectValidationMessage} from '../../utils/auth-utils';
import {EmailUtils} from '../../utils/email-utils';

describe('AuthController - Signup', () => {
	let mailpitApiUrl: string;
	let webUrl: string;
	let emailVerificationExpiration: string;
	let httpServer: Server;

	beforeAll(async () => {
		const app = getApp();
		const config = app.get(ConfigurationService);
		mailpitApiUrl = config.get('EMAIL_UI_URL');
		webUrl = config.get('WEB_BASE_URL');
		emailVerificationExpiration = config.get('EMAIL_VERIFICATION_EXPIRATION');

		httpServer = app.getHttpServer();
	});

	beforeEach(async () => {
		await EmailUtils.clearEmails(mailpitApiUrl);
	});

	async function expectWelcomeEmail(email: string, name: string) {
		const welcomeEmail = await EmailUtils.findEmailByRecipient(email, mailpitApiUrl);
		expect(welcomeEmail).toBeDefined();

		const body = EmailUtils.normalizeEmailText(welcomeEmail?.Text);
		const code = EmailUtils.extractCode(body);

		expect(welcomeEmail?.To[0].Address).toEqual(email);
		expect(welcomeEmail?.Subject).toBe('Confirm your email for Tempo');
		expect(body).toEqual(EmailUtils.getWelcomeEmailBody(email, name, webUrl, code, emailVerificationExpiration));
	}

	describe('POST /auth/signup', () => {
		it('should create a new account and send welcome email', async () => {
			const signUpDto = createAccountCredentials();

			const response = await request(httpServer).post('/auth/signup').send(signUpDto).expect(201);

			expect(response.body?.email).toEqual(signUpDto.email);
			expect(response.body?.name).toEqual(signUpDto.name);
			expect(response.body?.id).toBeDefined();
			expect(response.body?.isEmailVerified).toBe(false);
			expect(response.body?.createdAt).toBeDefined();

			await expectWelcomeEmail(signUpDto.email, signUpDto.name);
		});

		it('should store the email trimmed and lowercased', async () => {
			const signUpDto = createAccountCredentials();
			const response = await request(httpServer)
				.post('/auth/signup')
				.send({...signUpDto, email: `  ${signUpDto.email.toUpperCase()} `})
				.expect(201);

			expect(response.body.email).toBe(signUpDto.email.toLowerCase());
		});

		it('should fail with 409 Conflict if the email is already in use with different casing', async () => {
			const existingAccountDto = createAccountCredentials();
			await request(httpServer).post('/auth/signup').send(existingAccountDto).expect(201);

			await request(httpServer)
				.post('/auth/signup')
				.send({...createAccountCredentials(), email: existingAccountDto.email.toUpperCase()})
				.expect(409);
		});

		it('should fail with 409 Conflict if email is already in use', async () => {
			const existingAccountDto = createAccountCredentials();
			await request(httpServer).post('/auth/signup').send(existingAccountDto).expect(201);

			const response = await request(httpServer)
				.post('/auth/signup')
				.send({...createAccountCredentials(), email: existingAccountDto.email})
				.expect(409);
			expect(response.body.message).toBe(EMAIL_ALREADY_IN_USE);
		});

		it.each<[string, Partial<SignUpDto>, RegExp]>([
			['password is too short', {password: '123'}, /password must be longer than or equal to 8 characters/i],
			['name is missing', {name: undefined}, /name should not be empty/i],
			['email is missing', {email: undefined}, /email should not be empty/i],
			['name is empty', {name: ''}, /name should not be empty/i],
			['email is empty', {email: ''}, /email should not be empty/i],
			['email is not a valid email format', {email: 'not-a-valid-email'}, /email must be an email/i],
		])('should fail with 400 Bad Request if %s', async (_case, overrides, message) => {
			const response = await request(httpServer)
				.post('/auth/signup')
				.send({...createAccountCredentials(), ...overrides})
				.expect(400);
			expectValidationMessage(response, message);
		});
	});

	describe('POST /auth/signup/resend', () => {
		it('should send a new verification email for an unverified account', async () => {
			const unverifiedAgent = await loginAgent(httpServer, UNVERIFIED_ACCOUNT_EMAIL, UNVERIFIED_ACCOUNT_PASSWORD);

			const response = await unverifiedAgent.post('/auth/signup/resend').send().expect(200);
			expect(response.body.message).toBe(EMAIL_VERIFICATION_SENT);

			await expectWelcomeEmail(UNVERIFIED_ACCOUNT_EMAIL, UNVERIFIED_ACCOUNT_NAME);
		});

		it('should fail with 400 Bad Request if the email is already verified', async () => {
			const verifiedAgent = await loginAgent(httpServer, VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);

			const response = await verifiedAgent.post('/auth/signup/resend').send().expect(400);
			expect(response.body.message).toBe(EMAIL_ALREADY_VERIFIED);

			expect(await EmailUtils.findEmailByRecipient(VERIFIED_ACCOUNT_EMAIL, mailpitApiUrl)).toBeUndefined();
		});
	});

	describe('POST /auth/signup/verify', () => {
		let verificationCode: string;
		let accountCredentials: SignUpDto;
		let agent: TestAgent;

		beforeEach(async () => {
			accountCredentials = createAccountCredentials();
			await request(httpServer).post('/auth/signup').send(accountCredentials).expect(201);
			verificationCode = await EmailUtils.getVerificationCode(accountCredentials.email, mailpitApiUrl);

			agent = await loginAgent(httpServer, accountCredentials.email, accountCredentials.password);

			await EmailUtils.clearEmails(mailpitApiUrl);
		});

		async function verify(verifier: TestAgent | ReturnType<typeof request>, code: string) {
			const response = await verifier
				.post('/auth/signup/verify')
				.send({code, email: accountCredentials.email})
				.expect(200);
			expect(response.body.message).toBe(EMAIL_VERIFICATION_SUCCESS);
			return response;
		}

		it('should verify email with correct code and email (unauthenticated)', async () => {
			const response = await verify(request(httpServer), verificationCode);
			expect(getSessionCookie(response)).toBeDefined();

			const newAgent = await loginAgent(httpServer, accountCredentials.email, accountCredentials.password);
			const meResponse = await newAgent.get('/accounts/me').expect(200);
			expect(meResponse.body.isEmailVerified).toBe(true);
		});

		it('should verify email with correct code and email (authenticated)', async () => {
			await verify(agent, verificationCode);

			const accountResponse = await agent.get('/accounts/me').expect(200);
			expect(accountResponse.body.isEmailVerified).toBe(true);
		});

		it('should verify email with resend code (authenticated)', async () => {
			await agent.post('/auth/signup/resend').send().expect(200);

			const resendCode = await EmailUtils.getVerificationCode(accountCredentials.email, mailpitApiUrl);
			expect(resendCode).not.toEqual(verificationCode);

			await verify(agent, resendCode);

			const meResponse = await agent.get('/accounts/me').expect(200);
			expect(meResponse.body.isEmailVerified).toBe(true);
		});

		it('should fail with 400 Bad Request for invalid code', async () => {
			const response = await request(httpServer)
				.post('/auth/signup/verify')
				.send({code: '000000', email: accountCredentials.email})
				.expect(400);
			expect(response.body.message).toBe(EMAIL_INVALID_TOKEN);
		});

		it('should fail with 400 Bad Request if email is already verified', async () => {
			const payload = {code: verificationCode, email: accountCredentials.email};
			await request(httpServer).post('/auth/signup/verify').send(payload).expect(200);

			const response = await request(httpServer).post('/auth/signup/verify').send(payload).expect(400);
			expect(response.body.message).toBe(EMAIL_INVALID_TOKEN);
		});
	});

	describe('POST /auth/signup/verify validation', () => {
		it.each([
			['malformed code (too short)', {code: '12345'}, /Verification code must be 6 digits/i],
			['malformed code (non-digit)', {code: 'abcdef'}, /Verification code must be 6 digits/i],
			['missing code', {}, /code should not be empty/i],
			['missing email', {code: '123456'}, /email should not be empty/i],
			['invalid email format', {code: '123456', email: 'not-an-email'}, /email must be an email/i],
		])('should fail with 400 Bad Request for %s', async (_case, body, message) => {
			const response = await request(httpServer).post('/auth/signup/verify').send(body).expect(400);
			expectValidationMessage(response, message);
		});
	});
});
