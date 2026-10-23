import {INestApplication} from '@nestjs/common';
import Redis from 'ioredis';
import {Server} from 'node:net';
import request from 'supertest';
import {DataSource} from 'typeorm';

import {ConfigurationService} from '@core/config/config.service';
import {REDIS} from '@core/redis/redis.constants';
import {ACCOUNT_DELETED_EMAIL_SUBJECT, ACCOUNT_DELETED_MESSAGE} from '@modules/account/account-deletion.service';
import {BankAccountBalance} from '@modules/banking/bank-account-balance.entity';
import {BankAccount} from '@modules/banking/bank-account.entity';
import {BankConnection} from '@modules/banking/bank-connection.entity';
import {BankTransaction} from '@modules/banking/bank-transaction.entity';

import {seedBankingData} from '../../../scripts/seed-data/seed-banking-data';
import {VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD} from '../../../scripts/seed-data/seed.constants';
import {getApp, loginAgent} from '../../setup/e2e.setup';
import {createVerifiedAccount} from '../../utils/auth-utils';
import {EmailUtils} from '../../utils/email-utils';

describe('AccountController - DELETE /accounts/me', () => {
	let app: INestApplication;
	let httpServer: Server;
	let mailpitApiUrl: string;
	let dataSource: DataSource;
	let connectionRepository: ReturnType<DataSource['getRepository']>;
	let bankAccountRepository: ReturnType<DataSource['getRepository']>;
	let balanceRepository: ReturnType<DataSource['getRepository']>;
	let transactionRepository: ReturnType<DataSource['getRepository']>;
	let redis: Redis;

	beforeAll(async () => {
		app = getApp();
		httpServer = app.getHttpServer();
		const config = app.get(ConfigurationService);
		mailpitApiUrl = config.get('EMAIL_UI_URL');
		dataSource = app.get(DataSource);
		connectionRepository = dataSource.getRepository(BankConnection);
		bankAccountRepository = dataSource.getRepository(BankAccount);
		balanceRepository = dataSource.getRepository(BankAccountBalance);
		transactionRepository = dataSource.getRepository(BankTransaction);
		redis = app.get<Redis>(REDIS);
	});

	beforeEach(async () => {
		await EmailUtils.clearEmails(mailpitApiUrl);
	});

	async function countOwnedAccounts(repository: ReturnType<DataSource['getRepository']>, accountId: string) {
		return repository.count({where: {account: {id: accountId}}});
	}

	it('deletes a verified account with password confirmation and cascades all bank data', async () => {
		const {
			id: accountId,
			credentials: {email, password},
			agent,
		} = await createVerifiedAccount(httpServer, mailpitApiUrl);

		const {body: pat} = await agent
			.post('/personal-access-tokens')
			.set('Origin', 'http://localhost:5173')
			.send({name: 'Example deletion client'})
			.expect(201);
		await seedBankingData(app, {accountEmail: email});
		expect(await countOwnedAccounts(connectionRepository, accountId)).toBe(1);

		// A second session of the same account must die with the account too.
		const secondSessionAgent = await loginAgent(httpServer, email, password);
		await secondSessionAgent.get('/accounts/me').expect(200);

		// Pending bank authorization states are cleaned up per account, not globally.
		const ownedStateKey = `banking:authorization:e2e-owned-${accountId}`;
		const otherStateKey = 'banking:authorization:e2e-other';
		await redis.set(
			ownedStateKey,
			JSON.stringify({
				accountId,
				connectionId: 'e2e-connection',
				aspspName: 'ABN AMRO',
				aspspCountry: 'NL',
				expiresAt: Date.now() + 60_000,
			}),
			'EX',
			600,
		);
		await redis.set(
			otherStateKey,
			JSON.stringify({
				accountId: 'someone-else',
				connectionId: 'e2e-connection-2',
				aspspName: 'Rabobank',
				aspspCountry: 'NL',
				expiresAt: Date.now() + 60_000,
			}),
			'EX',
			600,
		);

		// A pending email change is cancelled with the account.
		await agent
			.post('/auth/change-email/request')
			.set('Origin', new URL(app.get(ConfigurationService).get('WEB_BASE_URL')).origin)
			.send({newEmail: `pending-${accountId}@example.test`})
			.expect(200);
		const emailChangeKey = `${app.get(ConfigurationService).get('EMAIL_VERIFICATION_REDIS_KEY')}:change:${accountId}`;
		expect(await redis.get(emailChangeKey)).not.toBeNull();

		// Wrong password is rejected and the account survives.
		await agent.delete('/accounts/me').send({password: 'wrong-password'}).expect(401);
		expect(await countOwnedAccounts(connectionRepository, accountId)).toBe(1);
		expect(await redis.get(ownedStateKey)).not.toBeNull();

		const deleteResponse = await agent.delete('/accounts/me').send({password}).expect(200);
		expect(deleteResponse.body.message).toEqual(ACCOUNT_DELETED_MESSAGE);
		expect(
			await dataSource.query('SELECT id FROM personal_access_tokens WHERE "accountId" = $1', [accountId]),
		).toEqual([]);
		await request(httpServer).get('/bank-transactions').auth(pat.token, {type: 'bearer'}).expect(401);

		// FK cascades must have removed every bank-owned row.
		expect(await countOwnedAccounts(connectionRepository, accountId)).toBe(0);
		expect(await bankAccountRepository.count({where: {bankConnection: {account: {id: accountId}}}})).toBe(0);
		expect(
			await balanceRepository.count({where: {bankAccount: {bankConnection: {account: {id: accountId}}}}}),
		).toBe(0);
		expect(
			await transactionRepository.count({where: {bankAccount: {bankConnection: {account: {id: accountId}}}}}),
		).toBe(0);

		// The owned pending authorization state is gone; the other account's survives.
		expect(await redis.get(ownedStateKey)).toBeNull();
		expect(await redis.get(otherStateKey)).not.toBeNull();
		await redis.del(otherStateKey);
		expect(await redis.get(emailChangeKey)).toBeNull();

		// All sessions (including the caller's and the second session's) were revoked.
		await agent.get('/accounts/me').expect(401);
		await secondSessionAgent.get('/accounts/me').expect(401);

		// The account can no longer log in.
		await request(httpServer).post('/auth/login').send({email, password}).expect(401);

		// A farewell email is delivered to the deleted address.
		const farewellEmail = await EmailUtils.findEmailByRecipient(
			email,
			mailpitApiUrl,
			ACCOUNT_DELETED_EMAIL_SUBJECT,
		);
		expect(farewellEmail?.Subject).toEqual(ACCOUNT_DELETED_EMAIL_SUBJECT);
	}, 30_000);

	it('returns 400 Bad Request if the password is missing', async () => {
		const agent = await loginAgent(httpServer, VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);

		await agent
			.delete('/accounts/me')
			.send({})
			.expect(400)
			.expect((res) => {
				expect(res.body.message).toEqual(
					expect.arrayContaining([
						expect.stringMatching(/password must be longer than or equal to 8 characters/i),
					]),
				);
			});
	});
});
