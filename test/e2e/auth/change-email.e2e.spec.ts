import {faker} from '@faker-js/faker';
import {Server} from 'node:net';
import request from 'supertest';
import TestAgent from 'supertest/lib/agent';
import {DataSource} from 'typeorm';

import {ConfigurationService} from '@core/config/config.service';
import {EmailService} from '@core/email/email.service';
import {AccountService} from '@modules/account/account.service';
import {
	EMAIL_ALREADY_IN_USE,
	EMAIL_CHANGE_SUCCESS,
	EMAIL_INVALID_TOKEN,
	EMAIL_VERIFICATION_SENT,
} from '@modules/auth/api/constants/api-messages.constants';
import {
	EMAIL_CHANGED_SUBJECT,
	EMAIL_CHANGE_VERIFICATION_SUBJECT,
	EmailVerifierService,
} from '@modules/auth/services/email-verifier.service';

import {
	EMAIL_CHANGE_ACCOUNT_EMAIL,
	EMAIL_CHANGE_ACCOUNT_NAME,
	EMAIL_CHANGE_ACCOUNT_PASSWORD,
	VERIFIED_ACCOUNT_EMAIL,
	VERIFIED_ACCOUNT_PASSWORD,
} from '../../../scripts/seed-data/seed.constants';
import {getApp, loginAgent} from '../../setup/e2e.setup';
import {UUID_REGEX} from '../../types/regex.constants';
import {createAccountCredentials, createVerifiedAccount, expectValidationMessage} from '../../utils/auth-utils';
import {EmailUtils} from '../../utils/email-utils';

const TEST_WEB_BASE_URL = 'https://app.example.test';
const TEST_SIBLING_ORIGIN = 'https://evil.example.test';

// Use a reserved same-site pair so the regression models a sibling subdomain, not just a cross-site Origin.
process.env.WEB_BASE_URL = TEST_WEB_BASE_URL;

const REJECTED_ORIGINS: [kind: string, origin: string | undefined][] = [
	['sibling', TEST_SIBLING_ORIGIN],
	['missing', undefined],
	['opaque', 'null'],
	['malformed', 'not-an-origin'],
	['non-canonical trailing slash', `${TEST_WEB_BASE_URL}/`],
	['non-canonical explicit default port', `${TEST_WEB_BASE_URL}:443`],
];

describe('AuthController - Change email', () => {
	let mailpitApiUrl: string;
	let webUrl: string;
	let webOrigin: string;
	let emailVerificationExpiration: string;
	let httpServer: Server;
	let verifiedAgent: TestAgent;
	let existingEmail: string;

	beforeAll(async () => {
		const app = getApp();

		const config = app.get(ConfigurationService);
		mailpitApiUrl = config.get('EMAIL_UI_URL');
		webUrl = config.get('WEB_BASE_URL');
		webOrigin = new URL(webUrl).origin;
		expect(webOrigin).toBe(TEST_WEB_BASE_URL);
		emailVerificationExpiration = config.get('EMAIL_VERIFICATION_EXPIRATION');
		httpServer = app.getHttpServer();

		const conflictAccount = createAccountCredentials();
		await request(httpServer).post('/auth/signup').send(conflictAccount).expect(201);
		existingEmail = conflictAccount.email;

		verifiedAgent = await loginAgent(httpServer, VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);
	});

	beforeEach(async () => {
		await EmailUtils.clearEmails(mailpitApiUrl);
	});

	/** Sends a form-encoded (CORS-simple) request, which is what the Origin check has to stop. */
	function sendWithOrigin(test: request.Test, origin: string | undefined, body: object) {
		if (origin !== undefined) test.set('Origin', origin);
		return test.type('form').send(body);
	}

	function requestChange(agent: TestAgent, body: object) {
		return agent.post('/auth/change-email/request').set('Origin', webOrigin).send(body);
	}

	function verifyChange(agent: TestAgent, body: object) {
		return agent.post('/auth/change-email/verify').set('Origin', webOrigin).send(body);
	}

	describe('HEAD /auth/change-email/check', () => {
		function check(email?: string) {
			const query = email === undefined ? '' : `?email=${encodeURIComponent(email)}`;
			return verifiedAgent.head(`/auth/change-email/check${query}`);
		}

		it('should return 204 No Content for an available email', async () => {
			await check(faker.internet.email()).expect(204);
		});

		it.each([
			['the email is already in use by another account', () => existingEmail],
			["the email is the account's own email", () => VERIFIED_ACCOUNT_EMAIL],
			['the email differs from an existing one only by casing', () => existingEmail.toUpperCase()],
		])('should return 409 Conflict if %s', async (_case, email) => {
			await check(email()).expect(409);
		});

		it.each([
			['missing', undefined],
			['empty', ''],
			['invalid', 'not-a-valid-email'],
		])('should return 400 Bad Request if the email query parameter is %s', async (_case, email) => {
			await check(email).expect(400);
		});
	});

	describe('POST /auth/change-email/request', () => {
		it('should send a verification email to the new email address for a verified account', async () => {
			const newEmail = faker.internet.email().toLowerCase();

			const response = await requestChange(verifiedAgent, {newEmail}).expect(200);
			expect(response.body.message).toBe(EMAIL_VERIFICATION_SENT);

			const verificationEmail = await EmailUtils.findEmailByRecipient(newEmail, mailpitApiUrl);
			const body = EmailUtils.normalizeEmailText(verificationEmail?.Text);
			const token = EmailUtils.extractToken(body);

			expect(verificationEmail?.To[0].Address).toEqual(newEmail);
			expect(verificationEmail?.Subject).toBe(EMAIL_CHANGE_VERIFICATION_SUBJECT);
			expect(body).toBe(EmailUtils.getVerifyNewEmailBody(newEmail, webUrl, token, emailVerificationExpiration));
			expect(token).toMatch(UUID_REGEX);
		});

		it.each(REJECTED_ORIGINS)(
			'should reject an email change request with a %s Origin before sending email',
			async (_kind, origin) => {
				const attackerEmail = `takeover-${faker.string.uuid()}@attacker.example.test`;

				await sendWithOrigin(verifiedAgent.post('/auth/change-email/request'), origin, {
					newEmail: attackerEmail,
				}).expect(403);

				expect(await EmailUtils.findEmailByRecipient(attackerEmail, mailpitApiUrl)).toBeUndefined();
			},
		);

		it('should send the verification link to the normalized new email', async () => {
			const newEmail = faker.internet.email().toLowerCase();

			await requestChange(verifiedAgent, {newEmail: ` ${newEmail.toUpperCase()} `}).expect(200);

			const verificationEmail = await EmailUtils.findEmailByRecipient(newEmail, mailpitApiUrl);
			expect(verificationEmail?.To[0].Address).toBe(newEmail);
		});

		it('should fail with 409 Conflict if the new email is already in use', async () => {
			const response = await requestChange(verifiedAgent, {newEmail: existingEmail}).expect(409);
			expect(response.body.message).toBe(EMAIL_ALREADY_IN_USE);
		});

		it.each([
			['newEmail is not a valid email format', {newEmail: 'not-an-email'}, /newEmail must be an email/i],
			['newEmail is missing', {}, /newEmail should not be empty/i],
		])('should fail with 400 Bad Request if %s', async (_case, body, message) => {
			const response = await requestChange(verifiedAgent, body).expect(400);
			expectValidationMessage(response, message);
		});
	});

	describe('POST /auth/change-email/verify', () => {
		// Successful verifications change the seeded account's email; track it so each test can log in.
		let accountEmail = EMAIL_CHANGE_ACCOUNT_EMAIL;
		let agent: TestAgent;
		let token: string;
		let newEmailAddress: string;

		beforeEach(async () => {
			agent = await loginAgent(httpServer, accountEmail, EMAIL_CHANGE_ACCOUNT_PASSWORD);

			newEmailAddress = faker.internet.email().toLowerCase();
			await requestChange(agent, {newEmail: newEmailAddress}).expect(200);
			token = await EmailUtils.getToken(newEmailAddress, mailpitApiUrl);

			await EmailUtils.clearEmails(mailpitApiUrl);
		});

		async function expectAccountEmail(email: string) {
			const meResponse = await agent.get('/accounts/me').expect(200);
			expect(meResponse.body.email).toBe(email);
		}

		it('should change the email with a valid token for an authenticated, verified account', async () => {
			const previousEmail = accountEmail;
			const response = await verifyChange(agent, {token, email: newEmailAddress}).expect(200);
			expect(response.body.message).toBe(EMAIL_CHANGE_SUCCESS);

			await expectAccountEmail(newEmailAddress);
			accountEmail = newEmailAddress;

			const notice = await EmailUtils.findEmailByRecipient(previousEmail, mailpitApiUrl, EMAIL_CHANGED_SUBJECT);
			expect(EmailUtils.normalizeEmailText(notice?.Text)).toBe(
				EmailUtils.getEmailChangedBody(EMAIL_CHANGE_ACCOUNT_NAME, previousEmail, newEmailAddress),
			);
		});

		it('should preserve a new request made during an in-flight confirmation', async () => {
			const app = getApp();
			const accounts = app.get(AccountService);
			const verifier = app.get(EmailVerifierService);
			const account = await accounts.findByEmail(accountEmail);
			expect(account).not.toBeNull();
			const newerEmail = faker.internet.email().toLowerCase();
			let release!: () => void;
			let entered!: () => void;
			const enteredValidation = new Promise<void>((resolve) => {
				entered = resolve;
			});
			const continueValidation = new Promise<void>((resolve) => {
				release = resolve;
			});
			const validate = accounts.validateEmailIsUnique.bind(accounts);
			const spy = jest.spyOn(accounts, 'validateEmailIsUnique').mockImplementationOnce(async (email) => {
				await validate(email);
				entered();
				await continueValidation;
			});
			try {
				const confirming = verifier.verifyEmailChange(account!, token, newEmailAddress);
				await enteredValidation;
				let requestCompleted = false;
				const requesting = verifier.requestEmailChange(account!, newerEmail).then(() => {
					requestCompleted = true;
				});

				// Wait until the request either completes without waiting or waits on the account row lock.
				let waitingOnLock = false;
				for (let attempt = 0; attempt < 100 && !requestCompleted && !waitingOnLock; attempt++) {
					const [result] = await app
						.get(DataSource)
						.query(
							"SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock') AS waiting",
						);
					waitingOnLock = result.waiting;
					if (!requestCompleted && !waitingOnLock) await new Promise((resolve) => setTimeout(resolve, 10));
				}
				expect(requestCompleted || waitingOnLock).toBe(true);
				release();
				await Promise.all([confirming, requesting]);
				accountEmail = newEmailAddress;
				const newerToken = await EmailUtils.getToken(newerEmail, mailpitApiUrl);
				await verifyChange(agent, {token: newerToken, email: newerEmail}).expect(200);
				await expectAccountEmail(newerEmail);
				accountEmail = newerEmail;
			} finally {
				release();
				spy.mockRestore();
			}
		});

		it('should consume a token only once under concurrent confirmations', async () => {
			const responses = await Promise.all([
				verifyChange(agent, {token, email: newEmailAddress}),
				verifyChange(agent, {token, email: newEmailAddress}),
			]);
			expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);
			await expectAccountEmail(newEmailAddress);
			accountEmail = newEmailAddress;
		});

		it('should report success if the old-address notice cannot be queued after the change', async () => {
			const send = jest
				.spyOn(getApp().get(EmailService), 'send')
				.mockRejectedValueOnce(new Error('Queue unavailable'));
			try {
				await verifyChange(agent, {token, email: newEmailAddress}).expect(200);
				await expectAccountEmail(newEmailAddress);
				accountEmail = newEmailAddress;
			} finally {
				send.mockRestore();
			}
		});

		it('should not notify the old address when verification fails', async () => {
			await verifyChange(agent, {token: faker.string.uuid(), email: newEmailAddress}).expect(400);

			expect(
				await EmailUtils.findEmailByRecipient(accountEmail, mailpitApiUrl, EMAIL_CHANGED_SUBJECT),
			).toBeUndefined();
		});

		it.each(REJECTED_ORIGINS)(
			'should reject email verification with a %s Origin without changing the email or consuming its token',
			async (_kind, origin) => {
				await sendWithOrigin(agent.post('/auth/change-email/verify'), origin, {
					token,
					email: newEmailAddress,
				}).expect(403);
				await expectAccountEmail(accountEmail);

				await verifyChange(agent, {token, email: newEmailAddress}).expect(200);
				await expectAccountEmail(newEmailAddress);
				accountEmail = newEmailAddress;
			},
		);

		it('should fail with 400 Bad Request for an invalid token', async () => {
			const response = await verifyChange(agent, {token: faker.string.uuid(), email: newEmailAddress}).expect(
				400,
			);
			expect(response.body.message).toBe(EMAIL_INVALID_TOKEN);
		});

		it('should fail with 400 Bad Request if the token has already been used', async () => {
			const dto = {token, email: newEmailAddress};
			await verifyChange(agent, dto).expect(200);
			accountEmail = newEmailAddress;

			const agentWithNewEmail = await loginAgent(httpServer, newEmailAddress, EMAIL_CHANGE_ACCOUNT_PASSWORD);
			const response = await verifyChange(agentWithNewEmail, dto).expect(400);
			expect(response.body.message).toBe(EMAIL_INVALID_TOKEN);
		});

		it.each([
			['an invalid token (not UUID)', {token: '12345'}],
			['a missing token', {}],
		])('should fail with 400 Bad Request for %s', async (_case, body) => {
			const response = await verifyChange(agent, body).expect(400);
			expectValidationMessage(response, /token must be a UUID/i);
		});

		it('should reject an older link once a newer change has been requested', async () => {
			const newerEmail = faker.internet.email().toLowerCase();
			await requestChange(agent, {newEmail: newerEmail}).expect(200);
			const newerToken = await EmailUtils.getToken(newerEmail, mailpitApiUrl);

			const response = await verifyChange(agent, {token, email: newEmailAddress}).expect(400);
			expect(response.body.message).toBe(EMAIL_INVALID_TOKEN);
			await expectAccountEmail(accountEmail);

			await verifyChange(agent, {token: newerToken, email: newerEmail}).expect(200);
			await expectAccountEmail(newerEmail);
			accountEmail = newerEmail;
		});

		it("should not let another account redeem this account's link", async () => {
			const otherAccount = await createVerifiedAccount(httpServer, mailpitApiUrl);

			const response = await verifyChange(otherAccount.agent, {token, email: newEmailAddress}).expect(400);
			expect(response.body.message).toBe(EMAIL_INVALID_TOKEN);
			const otherMe = await otherAccount.agent.get('/accounts/me').expect(200);
			expect(otherMe.body.email).toBe(otherAccount.credentials.email);

			await verifyChange(agent, {token, email: newEmailAddress}).expect(200);
			await expectAccountEmail(newEmailAddress);
			accountEmail = newEmailAddress;
		});

		it('should reject a link whose email does not match the requested one', async () => {
			const response = await verifyChange(agent, {
				token,
				email: faker.internet.email().toLowerCase(),
			}).expect(400);
			expect(response.body.message).toBe(EMAIL_INVALID_TOKEN);
			await expectAccountEmail(accountEmail);
		});

		it('should fail with 409 Conflict if the email associated with the token is now taken (race condition)', async () => {
			// Another verified account requests the same target email and verifies it first.
			const otherAccount = await createVerifiedAccount(httpServer, mailpitApiUrl);
			await requestChange(otherAccount.agent, {newEmail: newEmailAddress}).expect(200);
			const otherToken = await EmailUtils.getToken(newEmailAddress, mailpitApiUrl);
			expect(otherToken).not.toEqual(token);
			await verifyChange(otherAccount.agent, {token: otherToken, email: newEmailAddress}).expect(200);

			const response = await verifyChange(agent, {token, email: newEmailAddress}).expect(409);
			expect(response.body.message).toBe(EMAIL_ALREADY_IN_USE);
		});
	});
});
