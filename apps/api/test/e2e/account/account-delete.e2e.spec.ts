import {jest} from '@jest/globals';
import {INestApplication} from '@nestjs/common';
import Redis from 'ioredis';
import {Server} from 'node:net';
import request from 'supertest';
import {DataSource} from 'typeorm';

import {ConfigurationService} from '@core/config/config.service';
import {REDIS} from '@core/redis/redis.constants';
import {ACCOUNT_DELETED_EMAIL_SUBJECT, ACCOUNT_DELETED_MESSAGE} from '@modules/account/account-deletion.service';
import {INVALID_PASSWORD, PASSWORD_RESET_INVALID_TOKEN} from '@modules/auth/api/constants/api-messages.constants';
import {BankAccountBalance} from '@modules/banking/bank-account-balance.entity';
import {BankAccount} from '@modules/banking/bank-account.entity';
import {BankConnection} from '@modules/banking/bank-connection.entity';
import {BankTransaction} from '@modules/banking/bank-transaction.entity';
import {BankingEncryptionService} from '@modules/banking/services/banking-encryption.service';
import {BankingSyncService} from '@modules/banking/services/banking-sync.service';
import {EnableBankingClient, EnableBankingClientError} from '@modules/banking/services/enable-banking.client';

import {BankingFixtures} from '../../../scripts/seed-data/banking-fixtures';
import {seedBankingData} from '../../../scripts/seed-data/seed-banking-data';
import {VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD} from '../../../scripts/seed-data/seed.constants';
import {getApp, loginAgent} from '../../setup/e2e.setup';
import {createVerifiedAccount} from '../../utils/auth-utils';
import {fetchedTransactions} from '../../utils/banking-utils';
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
	let fixtures: BankingFixtures;
	let encryption: BankingEncryptionService;
	let enableBankingClient: EnableBankingClient;
	let deleteSession: jest.SpiedFunction<EnableBankingClient['deleteSession']>;

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
		fixtures = new BankingFixtures(app);
		encryption = app.get(BankingEncryptionService);
		enableBankingClient = app.get(EnableBankingClient);
		deleteSession = jest.spyOn(enableBankingClient, 'deleteSession');
	});

	beforeEach(async () => {
		await EmailUtils.clearEmails(mailpitApiUrl);
		deleteSession.mockReset();
		deleteSession.mockResolvedValue(undefined);
	});

	afterAll(() => {
		jest.restoreAllMocks();
	});

	async function countOwnedAccounts(repository: ReturnType<DataSource['getRepository']>, accountId: string) {
		return repository.count({where: {account: {id: accountId}}});
	}

	it('deletes a verified account with password confirmation, revokes its bank consents and cascades all bank data', async () => {
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
		await connectionRepository.update(
			{accountId},
			{providerSessionId: encryption.encrypt('account-delete-session-one')},
		);
		await fixtures.createConnection(
			{id: accountId},
			{aspspName: 'Example Bank', providerSessionId: encryption.encrypt('account-delete-session-two')},
		);
		await fixtures.createConnection({id: accountId}, {status: 'PENDING_AUTHORIZATION', providerSessionId: null});
		expect(await countOwnedAccounts(connectionRepository, accountId)).toBe(3);
		const connectionsAtRevocation: number[] = [];
		deleteSession.mockImplementation(async (sessionId) => {
			connectionsAtRevocation.push(await countOwnedAccounts(connectionRepository, accountId));
			// One failing provider call must not stop the account's deletion.
			if (sessionId === 'account-delete-session-two')
				throw new EnableBankingClientError('provider_request_failed', 500);
		});

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

		// A pending email change and a password reset link are cancelled with the account.
		await agent
			.post('/auth/change-email/request')
			.set('Origin', new URL(app.get(ConfigurationService).get('WEB_BASE_URL')).origin)
			.send({newEmail: `pending-${accountId}@example.test`, currentPassword: password})
			.expect(200);
		const emailChangeKey = `${app.get(ConfigurationService).get('EMAIL_VERIFICATION_REDIS_KEY')}:change:${accountId}`;
		expect(await redis.get(emailChangeKey)).not.toBeNull();
		await request(httpServer).post('/auth/reset-password/request').send({email}).expect(200);
		const resetEmail = await EmailUtils.findEmailByRecipient(email, mailpitApiUrl, 'Reset your Tempo password');
		const resetToken = EmailUtils.extractToken(resetEmail?.Text);

		// Wrong password is rejected and the account survives.
		const wrongPasswordResponse = await agent.delete('/accounts/me').send({password: 'wrong-password'}).expect(401);
		expect(wrongPasswordResponse.body.message).toBe(INVALID_PASSWORD);
		expect(await countOwnedAccounts(connectionRepository, accountId)).toBe(3);
		expect(deleteSession).not.toHaveBeenCalled();
		expect(await redis.get(ownedStateKey)).not.toBeNull();

		const deleteResponse = await agent.delete('/accounts/me').send({password}).expect(200);
		expect(deleteResponse.body.message).toEqual(ACCOUNT_DELETED_MESSAGE);
		// Every connection with a provider session was revoked once, while its row still existed.
		expect(deleteSession.mock.calls.map(([sessionId]) => sessionId).sort()).toEqual([
			'account-delete-session-one',
			'account-delete-session-two',
		]);
		expect(connectionsAtRevocation).toEqual([3, 3]);
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
		const resetResponse = await request(httpServer)
			.post('/auth/reset-password/verify')
			.send({token: resetToken, newPassword: `${password}-new`})
			.expect(400);
		expect(resetResponse.body.message).toBe(PASSWORD_RESET_INVALID_TOKEN);

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

	it('deletes the account while a bank sync is running, and the sync writes nothing back', async () => {
		const {
			id: accountId,
			credentials: {password},
			agent,
		} = await createVerifiedAccount(httpServer, mailpitApiUrl);
		const connection = await fixtures.createConnection(
			{id: accountId},
			{providerSessionId: encryption.encrypt('account-delete-sync-session'), nextSyncAt: new Date(0)},
		);
		const bankAccount = await fixtures.createBankAccount(connection, {providerAccountId: 'account-delete-sync'});
		let fetchStarted!: () => void;
		const started = new Promise<void>((resolve) => (fetchStarted = resolve));
		let releaseFetch!: () => void;
		const released = new Promise<void>((resolve) => (releaseFetch = resolve));
		const syncSpies = [
			jest
				.spyOn(enableBankingClient, 'getSessionAccounts')
				.mockResolvedValue({status: 'AUTHORIZED', accountIds: ['account-delete-sync']}),
			jest.spyOn(enableBankingClient, 'getAccountBalances').mockResolvedValue([]),
			jest.spyOn(enableBankingClient, 'getAccountTransactions').mockImplementation(async () => {
				fetchStarted();
				await released;
				return fetchedTransactions([
					{amount: '10.00', currency: 'EUR', creditDebitIndicator: 'DBIT', bookingDate: '2026-08-20'},
				]);
			}),
		];

		try {
			const sync = app.get(BankingSyncService).synchronizeAutomatically(connection.id);
			const syncOutcome = sync.then(
				() => 'finished',
				(error: unknown) => error,
			);
			await started;
			expect(await redis.exists(`banking:sync:${connection.id}`)).toBe(1);

			// Deletion does not wait for the sync's lease.
			await agent.delete('/accounts/me').send({password}).expect(200);
			expect(deleteSession).toHaveBeenCalledWith('account-delete-sync-session', expect.any(AbortSignal));
			releaseFetch();

			expect(await syncOutcome).toMatchObject({status: 409});
			expect(await connectionRepository.countBy({id: connection.id})).toBe(0);
			expect(await bankAccountRepository.countBy({id: bankAccount.id})).toBe(0);
			expect(await transactionRepository.countBy({bankAccountId: bankAccount.id})).toBe(0);
			expect(await redis.exists(`banking:sync:${connection.id}`)).toBe(0);
		} finally {
			releaseFetch();
			for (const spy of syncSpies) spy.mockRestore();
		}
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
