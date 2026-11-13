import {INestApplication} from '@nestjs/common';
import {Server} from 'node:net';
import TestAgent from 'supertest/lib/agent';

import {Account} from '@modules/account/account.entity';
import {AccountUpdateDto} from '@modules/account/api/account-update.dto';

import {
	UNVERIFIED_ACCOUNT_EMAIL,
	UNVERIFIED_ACCOUNT_PASSWORD,
	VERIFIED_ACCOUNT_EMAIL,
	VERIFIED_ACCOUNT_PASSWORD,
} from '../../../scripts/seed-data/seed.constants';
import {getApp, loginAgent} from '../../setup/e2e.setup';
import {createVerifiedAccount, expectValidationMessage, uniqueName} from '../../utils/auth-utils';
import {MAILPIT_API_URL} from '../../utils/email-utils';

describe('Account controller - /me', () => {
	let httpServer: Server;
	let app: INestApplication;

	beforeAll(async () => {
		app = getApp();
		httpServer = app.getHttpServer();
	});

	describe('GET /accounts/me', () => {
		it('should return the current VERIFIED authenticated account', async () => {
			const agent = await loginAgent(httpServer, VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);

			const response = await agent.get('/accounts/me').expect(200);

			const account: Account = response.body;
			expect(account).toBeDefined();
			expect(account.id).toBeDefined();
			expect(account.email).toEqual(VERIFIED_ACCOUNT_EMAIL);
			expect(account.name).toEqual('Verified Account');
			expect(account.isEmailVerified).toBe(true);
			expect(account.timeZone).toBe('Europe/Amsterdam');
			expect(account.createdAt).toBeDefined();
			expect(account.password).toBeUndefined();
		});

		it('should return the current UNVERIFIED authenticated account', async () => {
			const agent = await loginAgent(httpServer, UNVERIFIED_ACCOUNT_EMAIL, UNVERIFIED_ACCOUNT_PASSWORD);

			const response = await agent.get('/accounts/me').expect(200);

			const account: Account = response.body;
			expect(account).toBeDefined();
			expect(account.id).toBeDefined();
			expect(account.email).toEqual(UNVERIFIED_ACCOUNT_EMAIL);
			expect(account.name).toEqual('Unverified Account');
			expect(account.isEmailVerified).toBe(false);
			expect(account.createdAt).toBeDefined();
			expect(account.password).toBeUndefined();
		});
	});

	describe('PATCH /accounts/me', () => {
		let verifiedAgent: TestAgent;

		beforeAll(async () => {
			verifiedAgent = await loginAgent(httpServer, VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);
		});

		it('should update the name for an authenticated VERIFIED account', async () => {
			const newName = uniqueName();
			const updateDto: AccountUpdateDto = {name: newName};

			const patchResponse = await verifiedAgent.patch('/accounts/me').send(updateDto).expect(200);

			const updatedAccount: Account = patchResponse.body;
			expect(updatedAccount).toBeDefined();
			expect(updatedAccount.name).toEqual(newName);
			expect(updatedAccount.email).toEqual(VERIFIED_ACCOUNT_EMAIL);
			expect(updatedAccount.isEmailVerified).toBe(true);
			expect(updatedAccount.password).toBeUndefined();

			const getResponse = await verifiedAgent.get('/accounts/me').expect(200);
			expect(getResponse.body.name).toEqual(newName);
		});

		it('should strip disallowed fields and update the name for an authenticated VERIFIED account', async () => {
			await verifiedAgent
				.patch('/accounts/me')
				.send({name: 'Valid name Again', email: 'takeover@example.test', isEmailVerified: false})
				.expect(200)
				.expect((res) => {
					expect(res.body.name).toEqual('Valid name Again');
					expect(res.body.email).toEqual(VERIFIED_ACCOUNT_EMAIL);
					expect(res.body.isEmailVerified).toBe(true);
				});
		});

		it('should update the time zone alone, keeping the name', async () => {
			const owner = await createVerifiedAccount(httpServer, MAILPIT_API_URL);

			const {body: updated} = await owner.agent
				.patch('/accounts/me')
				.send({timeZone: 'Europe/Helsinki'})
				.expect(200);
			expect(updated).toMatchObject({name: owner.credentials.name, timeZone: 'Europe/Helsinki'});

			// Another spelling of a supported zone is stored in the API's spelling.
			await owner.agent.patch('/accounts/me').send({timeZone: 'europe/lisbon'}).expect(200);
			const {body: read} = await owner.agent.get('/accounts/me').expect(200);
			expect(read).toMatchObject({name: owner.credentials.name, timeZone: 'Europe/Lisbon'});
		});

		it.each([
			['the time zone is unknown', {timeZone: 'Mars/Olympus_Mons'}],
			['the time zone is empty', {timeZone: ''}],
			['the time zone is null', {timeZone: null}],
			['the time zone is not a string', {timeZone: 12345}],
		])('should return 400 Bad Request and keep the time zone if %s', async (_case, body) => {
			const owner = await createVerifiedAccount(httpServer, MAILPIT_API_URL, {timeZone: 'Europe/Lisbon'});

			const response = await owner.agent.patch('/accounts/me').send(body).expect(400);
			expectValidationMessage(response, /timeZone must be a supported IANA time zone/i);
			expect((await owner.agent.get('/accounts/me').expect(200)).body.timeZone).toBe('Europe/Lisbon');
		});

		it.each([
			['name is null', {name: null}, /name must be a string/i],
			['name is empty', {name: ''}, /name must be longer than or equal to 1 characters/i],
			['name is too long', {name: 'a'.repeat(256)}, /name must be shorter than or equal to 255 characters/i],
			['name is not a string', {name: 12345}, /name must be a string/i],
		])('should return 400 Bad Request if %s', async (_case, body, message) => {
			const response = await verifiedAgent.patch('/accounts/me').send(body).expect(400);
			expectValidationMessage(response, message);
		});
	});
});
