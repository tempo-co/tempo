import {faker} from '@faker-js/faker';
import {jest} from '@jest/globals';
import {INestApplication} from '@nestjs/common';
import Redis from 'ioredis';
import {generateKeyPairSync} from 'node:crypto';
import {Server} from 'node:net';
import request from 'supertest';
import TestAgent from 'supertest/lib/agent';
import {DataSource, In, Repository} from 'typeorm';

import {REDIS} from '@core/redis/redis.constants';
import {Account} from '@modules/account/account.entity';
import {AccountService} from '@modules/account/account.service';
import {BankAccountBalance} from '@modules/banking/bank-account-balance.entity';
import {BankAccount} from '@modules/banking/bank-account.entity';
import {BankConnection} from '@modules/banking/bank-connection.entity';
import {BankSyncRun} from '@modules/banking/bank-sync-run.entity';
import {
	BANK_TRANSACTION_FINANCIAL_EVENT_RULE_VERSION,
	BANK_TRANSACTION_FINANCIAL_EVENT_SOURCES,
	BANK_TRANSACTION_FINANCIAL_EVENT_TYPES,
} from '@modules/banking/bank-transaction-financial-event';
import {BankTransactionFxRate} from '@modules/banking/bank-transaction-fx-rate.entity';
import {BankTransaction} from '@modules/banking/bank-transaction.entity';
import {EnableBankingBalance, EnableBankingTransaction} from '@modules/banking/enable-banking.types';
import {BankingEncryptionService} from '@modules/banking/services/banking-encryption.service';
import {BankingSyncService} from '@modules/banking/services/banking-sync.service';
import {EnableBankingClient, EnableBankingClientError} from '@modules/banking/services/enable-banking.client';

import {BankingFixtures} from '../../../scripts/seed-data/banking-fixtures';
import {
	SESSION_TEST_ACCOUNT_EMAIL,
	SESSION_TEST_ACCOUNT_PASSWORD,
	VERIFIED_ACCOUNT_EMAIL,
	VERIFIED_ACCOUNT_PASSWORD,
} from '../../../scripts/seed-data/seed.constants';
import {getApp, loginAgent} from '../../setup/e2e.setup';

// The concrete adapter is exercised below against a mocked transport, never a live provider.
process.env.ENABLE_BANKING_API_URL = 'https://provider.example.test';
process.env.ENABLE_BANKING_APPLICATION_ID = 'test-only-placeholder';
process.env.ENABLE_BANKING_PRIVATE_KEY_B64 = Buffer.from(
	generateKeyPairSync('rsa', {modulusLength: 2048}).privateKey.export({type: 'pkcs8', format: 'pem'}),
).toString('base64');

describe('BankConnectionController', () => {
	let app: INestApplication;
	let httpServer: Server;
	let verifiedAgent: TestAgent;
	let otherVerifiedAgent: TestAgent;
	let account: Account;
	let fixtures: BankingFixtures;
	let bankConnectionRepository: Repository<BankConnection>;
	let bankAccountRepository: Repository<BankAccount>;
	let bankSyncRunRepository: Repository<BankSyncRun>;
	let bankAccountBalanceRepository: Repository<BankAccountBalance>;
	let bankTransactionRepository: Repository<BankTransaction>;
	let redis: Redis;
	let enableBankingClient: EnableBankingClient;
	let getAspsps: jest.SpiedFunction<EnableBankingClient['getAspsps']>;
	let startAuthorization: jest.SpiedFunction<EnableBankingClient['startAuthorization']>;
	let createSession: jest.SpiedFunction<EnableBankingClient['createSession']>;
	let getSessionAccounts: jest.SpiedFunction<EnableBankingClient['getSessionAccounts']>;
	let getAccountBalances: jest.SpiedFunction<EnableBankingClient['getAccountBalances']>;
	let getAccountTransactions: jest.SpiedFunction<EnableBankingClient['getAccountTransactions']>;
	const sessionAccountIdsBySession = new Map<string, string[]>();

	beforeAll(async () => {
		app = getApp();
		httpServer = app.getHttpServer();
		const seededAccount = await app.get(AccountService).findByEmail(VERIFIED_ACCOUNT_EMAIL);
		if (!seededAccount) throw new Error('Test account was not seeded.');
		account = seededAccount;

		fixtures = new BankingFixtures(app);
		bankConnectionRepository = fixtures.connections;
		bankAccountRepository = fixtures.bankAccounts;
		bankSyncRunRepository = fixtures.syncRuns;
		bankAccountBalanceRepository = fixtures.balances;
		bankTransactionRepository = fixtures.transactions;
		redis = app.get<Redis>(REDIS);
		enableBankingClient = app.get(EnableBankingClient);
		getAspsps = jest.spyOn(enableBankingClient, 'getAspsps');
		startAuthorization = jest.spyOn(enableBankingClient, 'startAuthorization');
		createSession = jest.spyOn(enableBankingClient, 'createSession');
		getSessionAccounts = jest.spyOn(enableBankingClient, 'getSessionAccounts');
		getSessionAccounts.mockImplementation(async (sessionId) => ({
			status: 'AUTHORIZED',
			accountIds: sessionAccountIdsBySession.get(sessionId) ?? [],
		}));
		getAccountBalances = jest.spyOn(enableBankingClient, 'getAccountBalances');
		getAccountTransactions = jest.spyOn(enableBankingClient, 'getAccountTransactions');

		getAspsps.mockResolvedValue([
			{
				name: 'ABN AMRO',
				country: 'NL',
				maximumConsentValiditySeconds: 60 * 60 * 24 * 90,
			},
		]);
		startAuthorization.mockResolvedValue({
			url: 'https://auth.example.test/authorize',
			authorizationId: faker.string.uuid(),
		});

		verifiedAgent = await loginAgent(httpServer, VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);
		otherVerifiedAgent = await loginAgent(httpServer, SESSION_TEST_ACCOUNT_EMAIL, SESSION_TEST_ACCOUNT_PASSWORD);

		await bankConnectionRepository
			.createQueryBuilder()
			.delete()
			.where('accountId = :accountId', {accountId: account.id})
			.execute();
	});

	afterAll(async () => {
		await bankConnectionRepository
			.createQueryBuilder()
			.delete()
			.where('accountId = :accountId', {accountId: account.id})
			.execute();
		jest.restoreAllMocks();
	});

	it('refreshes an owned connection before its automatic due time, skips a repeat within five minutes and returns the persisted finished run', async () => {
		const {connection, bankAccount} = await createAuthorizedConnection('manual-refresh-session');
		await bankConnectionRepository.update(connection.id, {
			nextSyncAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
			syncStatus: 'SUCCEEDED',
		});
		getAccountBalances.mockResolvedValue(makeBalances());
		const transactions = makeTransactions('manual-refresh').map((transaction) => ({
			transaction_id: transaction.providerTransactionId,
			transaction_amount: {amount: transaction.amount, currency: transaction.currency},
			credit_debit_indicator: transaction.creditDebitIndicator,
			booking_date: transaction.bookingDate,
			remittance_information: [transaction.description],
		}));
		const transport = jest.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
			const parsed = new URL(String(url));
			if (parsed.origin !== 'https://provider.example.test' || !parsed.pathname.endsWith('/transactions'))
				throw new Error('Unexpected provider request');
			const key = parsed.searchParams.get('continuation_key');
			return new Response(
				JSON.stringify(
					key === 'last-page'
						? {transactions: transactions.slice(2)}
						: key === 'empty-page'
							? {transactions: [], continuation_key: 'last-page'}
							: {transactions: transactions.slice(0, 2), continuation_key: 'empty-page'},
				),
				{status: 200},
			);
		});
		getAccountTransactions.mockImplementation((...args) =>
			EnableBankingClient.prototype.getAccountTransactions.call(enableBankingClient, ...args),
		);

		try {
			const response = await verifiedAgent
				.post(`/bank-connections/${connection.id}/refresh`)
				.set('Origin', 'http://localhost:5173')
				.set('User-Agent', 'ExampleBrowser/1.0')
				.set('X-Forwarded-For', '192.0.2.77')
				.set('Psu-Ip-Address', '192.0.2.88')
				.send({psuIpAddress: '192.0.2.99', psuUserAgent: 'ForgedBrowser/1.0'})
				.expect(200);
			const expectedPresence = {
				ipAddress: expect.stringMatching(/^(::ffff:)?127\.0\.0\.1$|^::1$/),
				userAgent: 'ExampleBrowser/1.0',
			};
			expect(getSessionAccounts).toHaveBeenLastCalledWith(
				'manual-refresh-session',
				expect.any(AbortSignal),
				expectedPresence,
			);
			expect(getAccountBalances).toHaveBeenLastCalledWith(
				bankAccount.providerAccountId,
				expect.any(AbortSignal),
				expectedPresence,
			);
			expect(getAccountTransactions).toHaveBeenLastCalledWith(
				bankAccount.providerAccountId,
				{strategy: 'longest'},
				expect.any(AbortSignal),
				expectedPresence,
			);
			expect(transport).toHaveBeenCalledTimes(3);
			for (const [, init] of transport.mock.calls) {
				const headers = new Headers(init?.headers);
				expect(headers.get('Psu-Ip-Address')).toEqual(expectedPresence.ipAddress);
				expect(headers.get('Psu-User-Agent')).toBe('ExampleBrowser/1.0');
			}
			expect(response.body).toMatchObject({
				status: 'SUCCEEDED',
				startedAt: expect.any(String),
				finishedAt: expect.any(String),
				requestedFrom: null,
				requestedTo: expect.any(String),
				accountsFetched: 1,
				balancesFetched: 2,
				transactionsFetched: 5,
				transactionsAdded: 5,
				errorMessage: null,
				rateLimitSource: null,
				retryAfterSeconds: null,
			});
			expect(Object.keys(response.body).sort()).toEqual(
				[
					'id',
					'status',
					'startedAt',
					'finishedAt',
					'requestedFrom',
					'requestedTo',
					'accountsFetched',
					'balancesFetched',
					'transactionsFetched',
					'transactionsAdded',
					'errorMessage',
					'rateLimitSource',
					'retryAfterSeconds',
				].sort(),
			);
			expect(await bankSyncRunRepository.findOneByOrFail({id: response.body.id})).toMatchObject({
				status: 'SUCCEEDED',
				finishedAt: expect.any(Date),
				transactionsFetched: 5,
			});
			expect(await bankTransactionRepository.countBy({bankAccountId: bankAccount.id})).toBe(5);
			const savedConnection = await bankConnectionRepository.findOneByOrFail({id: connection.id});
			expect(savedConnection).toMatchObject({syncStatus: 'SUCCEEDED', lastSyncError: null});
			expect(savedConnection.nextSyncAt!.getTime() - savedConnection.lastSyncedAt!.getTime()).toBe(
				6 * 60 * 60 * 1000,
			);
			const readback = await verifiedAgent.get(`/bank-connections/${connection.id}/transactions`).expect(200);
			expect(readback.body.transactions).toHaveLength(5);
			transport.mockClear();
			getAspsps.mockClear();
			getAccountBalances.mockClear();
			const runsBefore = await bankSyncRunRepository.countBy({bankConnection: {id: connection.id}});
			const skipped = await verifiedAgent
				.post(`/bank-connections/${connection.id}/refresh`)
				.set('Origin', 'http://localhost:5173')
				.set('User-Agent', 'ExampleBrowser/1.0')
				.expect(204);
			expect(skipped.text).toBe('');
			expect(getAspsps).not.toHaveBeenCalled();
			expect(getAccountBalances).not.toHaveBeenCalled();
			expect(transport).not.toHaveBeenCalled();
			expect(await bankSyncRunRepository.countBy({bankConnection: {id: connection.id}})).toBe(runsBefore);
			await bankConnectionRepository.update(connection.id, {
				lastSyncedAt: new Date(Date.now() - 5 * 60 * 1000 - 1000),
			});
			const second = await verifiedAgent
				.post(`/bank-connections/${connection.id}/refresh`)
				.set('Origin', 'http://localhost:5173')
				.set('User-Agent', 'ExampleBrowser/1.0')
				.expect(200);
			expect(second.body).toMatchObject({status: 'SUCCEEDED', transactionsAdded: 0, transactionsFetched: 5});
			expect(getAccountTransactions).toHaveBeenLastCalledWith(
				bankAccount.providerAccountId,
				{strategy: 'default', dateFrom: expect.any(String), dateTo: response.body.requestedTo},
				expect.any(AbortSignal),
				expectedPresence,
			);
			expect(await bankTransactionRepository.countBy({bankAccountId: bankAccount.id})).toBe(5);
		} finally {
			transport.mockRestore();
			getAccountTransactions.mockReset();
			await bankConnectionRepository.delete(connection.id);
		}
	});

	it.each([undefined, 'null', 'https://other.example.test'])(
		'rejects manual refresh with Origin %s',
		async (origin) => {
			const {connection} = await createAuthorizedConnection('manual-refresh-csrf');
			getSessionAccounts.mockClear();
			try {
				const refresh = verifiedAgent.post(`/bank-connections/${connection.id}/refresh`);
				if (origin !== undefined) refresh.set('Origin', origin);
				await refresh.expect(403);
				expect(getSessionAccounts).not.toHaveBeenCalled();
				expect(await bankSyncRunRepository.countBy({bankConnection: {id: connection.id}})).toBe(0);
			} finally {
				await bankConnectionRepository.delete(connection.id);
			}
		},
	);

	it('hides manual refresh lease state from another owner', async () => {
		const {connection} = await createAuthorizedConnection('manual-refresh-ownership');
		const lockKey = `banking:sync:${connection.id}`;
		getSessionAccounts.mockClear();
		try {
			await redis.set(lockKey, 'active-sync', 'EX', 60);
			const response = await otherVerifiedAgent
				.post(`/bank-connections/${connection.id}/refresh`)
				.set('Origin', 'http://localhost:5173')
				.expect(404);
			expect(response.body.message).toBe('Bank connection not found.');
			expect(getSessionAccounts).not.toHaveBeenCalled();
			expect(await bankSyncRunRepository.countBy({bankConnection: {id: connection.id}})).toBe(0);
			await verifiedAgent
				.post('/bank-connections/not-a-uuid/refresh')
				.set('Origin', 'http://localhost:5173')
				.expect(400);
			await verifiedAgent
				.post(`/bank-connections/${faker.string.uuid()}/refresh`)
				.set('Origin', 'http://localhost:5173')
				.expect(404);
		} finally {
			await redis.del(lockKey);
			await bankConnectionRepository.delete(connection.id);
		}
	});

	it.each([
		{requiredPsuHeaders: ['Psu-Ip-Address', 'Psu-User-Agent'], userAgent: ''},
		{requiredPsuHeaders: ['Psu-Ip-Address', 'Psu-User-Agent'], userAgent: '   '},
		{requiredPsuHeaders: ['Psu-Ip-Address', 'Psu-Accept'], userAgent: 'ExampleBrowser/1.0'},
		{requiredPsuHeaders: ['constructor'], userAgent: 'ExampleBrowser/1.0'},
	])('rejects manual refresh without genuine required context %j', async ({requiredPsuHeaders, userAgent}) => {
		const {connection} = await createAuthorizedConnection('manual-refresh-context');
		getAspsps.mockResolvedValueOnce([
			{name: 'ABN AMRO', country: 'NL', maximumConsentValiditySeconds: 86_400, requiredPsuHeaders},
		]);
		getSessionAccounts.mockClear();
		try {
			const response = await verifiedAgent
				.post(`/bank-connections/${connection.id}/refresh`)
				.set('Origin', 'http://localhost:5173')
				.set('User-Agent', userAgent)
				.set('Psu-User-Agent', 'ForgedBrowser/1.0')
				.set('Psu-Accept', 'application/json')
				.send({userAgent: 'ForgedBrowser/1.0'})
				.expect(400);
			expect(response.body.message).toBe(
				'Browser context required by this bank is unavailable. Please try again from your browser.',
			);
			expect(getSessionAccounts).not.toHaveBeenCalled();
			expect(await bankSyncRunRepository.countBy({bankConnection: {id: connection.id}})).toBe(0);
		} finally {
			await bankConnectionRepository.delete(connection.id);
		}
	});

	it('cancels a disconnected manual refresh without importing data or replaying presence', async () => {
		if (!httpServer.listening) await app.listen(0, '127.0.0.1');
		const {connection, bankAccount} = await createAuthorizedConnection('manual-refresh-disconnect');
		const nextSyncAt = new Date(Date.now() + 6 * 60 * 60 * 1000);
		await bankConnectionRepository.update(connection.id, {nextSyncAt, syncStatus: 'SUCCEEDED'});
		getAccountBalances.mockResolvedValue(makeBalances());
		let providerSignal: AbortSignal | undefined;
		let releaseProvider!: () => void;
		let enterProvider!: () => void;
		const entered = new Promise<void>((resolve) => {
			enterProvider = resolve;
		});
		getAccountTransactions.mockImplementationOnce(
			(_accountId, _options, signal) =>
				new Promise((resolve, reject) => {
					providerSignal = signal;
					releaseProvider = () => resolve(makeTransactions('cancelled-refresh'));
					signal?.addEventListener(
						'abort',
						() => reject(new EnableBankingClientError('provider_unreachable')),
						{once: true},
					);
					enterProvider();
				}),
		);
		const pending = verifiedAgent
			.post(`/bank-connections/${connection.id}/refresh`)
			.set('Origin', 'http://localhost:5173')
			.set('User-Agent', 'ExampleBrowser/1.0');
		const completed = pending.then(
			() => undefined,
			() => undefined,
		);
		try {
			await entered;
			pending.abort();
			for (let attempt = 0; attempt < 100 && !providerSignal?.aborted; attempt += 1)
				await new Promise((resolve) => setTimeout(resolve, 10));
			expect(providerSignal?.aborted).toBe(true);
			for (let attempt = 0; attempt < 100 && (await redis.exists(`banking:sync:${connection.id}`)); attempt += 1)
				await new Promise((resolve) => setTimeout(resolve, 10));
			expect(await redis.exists(`banking:sync:${connection.id}`)).toBe(0);
			expect(await bankTransactionRepository.countBy({bankAccountId: bankAccount.id})).toBe(0);
			expect(await bankAccountBalanceRepository.countBy({bankAccountId: bankAccount.id})).toBe(0);
			expect(await bankConnectionRepository.findOneByOrFail({id: connection.id})).toMatchObject({
				nextSyncAt,
				syncStatus: 'SUCCEEDED',
				syncStartedAt: null,
			});
			expect(await bankSyncRunRepository.findOneByOrFail({bankConnection: {id: connection.id}})).toMatchObject({
				status: 'FAILED',
				finishedAt: expect.any(Date),
			});
		} finally {
			releaseProvider?.();
			await completed;
			for (let attempt = 0; attempt < 100 && (await redis.exists(`banking:sync:${connection.id}`)); attempt += 1)
				await new Promise((resolve) => setTimeout(resolve, 10));
			await bankConnectionRepository.delete(connection.id);
		}
	});

	it('returns provider cooldown metadata and refuses manual refresh during Retry-After', async () => {
		const {connection} = await createAuthorizedConnection('manual-refresh-rate-limit');
		getAccountBalances.mockResolvedValue(makeBalances());
		getAccountBalances.mockRejectedValueOnce(new EnableBankingClientError('ASPSP_RATE_LIMIT_EXCEEDED', 429, 17));
		getAccountTransactions.mockClear();
		try {
			const response = await verifiedAgent
				.post(`/bank-connections/${connection.id}/refresh`)
				.set('Origin', 'http://localhost:5173')
				.set('User-Agent', 'ExampleBrowser/1.0')
				.expect(200);
			expect(response.body).toMatchObject({
				status: 'PARTIAL',
				finishedAt: expect.any(String),
				errorMessage:
					'Bank access is temporarily rate-limited. The next automatic attempt will wait for the provider cooldown.',
				rateLimitSource: 'enable-banking',
				retryAfterSeconds: 17,
			});
			expect(getAccountTransactions).not.toHaveBeenCalled();
			const saved = await bankConnectionRepository.findOneByOrFail({id: connection.id});
			expect(saved.syncStatus).toBe('RATE_LIMITED');
			expect(saved.nextSyncAt!.getTime() - new Date(response.body.finishedAt).getTime()).toBe(17_000);
			getAspsps.mockClear();
			getSessionAccounts.mockClear();
			const cooldown = await verifiedAgent
				.post(`/bank-connections/${connection.id}/refresh`)
				.set('Origin', 'http://localhost:5173')
				.set('User-Agent', 'ExampleBrowser/1.0')
				.expect(429);
			expect(Number(cooldown.headers['retry-after'])).toBeGreaterThan(0);
			expect(Number(cooldown.headers['retry-after'])).toBeLessThanOrEqual(17);
			expect(cooldown.body).toMatchObject({
				rateLimitSource: 'enable-banking',
				retryAfterSeconds: Number(cooldown.headers['retry-after']),
			});
			expect(getAspsps).not.toHaveBeenCalled();
			expect(getSessionAccounts).not.toHaveBeenCalled();
			expect(await bankSyncRunRepository.countBy({bankConnection: {id: connection.id}})).toBe(1);
			// Past both the provider cooldown and the five-minute foreground minimum.
			await bankConnectionRepository.update(connection.id, {
				nextSyncAt: new Date(Date.now() - 1),
				lastSyncedAt: new Date(Date.now() - 5 * 60 * 1000 - 1000),
			});
			getAccountTransactions.mockResolvedValue([]);
			const retry = await verifiedAgent
				.post(`/bank-connections/${connection.id}/refresh`)
				.set('Origin', 'http://localhost:5173')
				.set('User-Agent', 'ExampleBrowser/1.0')
				.expect(200);
			expect(retry.body.status).toBe('SUCCEEDED');
		} finally {
			await bankConnectionRepository.delete(connection.id);
		}
	});

	it.each(['manual', 'automatic'] as const)(
		'serializes an active %s sync with manual refresh, automatic sync and deletion',
		async (entry) => {
			if (!httpServer.listening) await app.listen(0, '127.0.0.1');
			const {connection} = await createAuthorizedConnection(`manual-refresh-lock-${entry}`);
			getAccountBalances.mockResolvedValue(makeBalances());
			getAccountTransactions.mockClear();
			let enterProvider!: () => void;
			let releaseProvider!: () => void;
			const entered = new Promise<void>((resolve) => {
				enterProvider = resolve;
			});
			getAccountTransactions.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						releaseProvider = () => resolve([]);
						enterProvider();
					}),
			);
			const active =
				entry === 'manual'
					? verifiedAgent
							.post(`/bank-connections/${connection.id}/refresh`)
							.set('Origin', 'http://localhost:5173')
							.set('User-Agent', 'ExampleBrowser/1.0')
							.expect(200)
							.then(({body}) => body)
					: app.get(BankingSyncService).synchronizeAutomatically(connection.id);
			try {
				await entered;
				const conflict = await verifiedAgent
					.post(`/bank-connections/${connection.id}/refresh`)
					.set('Origin', 'http://localhost:5173')
					.expect(409);
				expect(conflict.body.message).toBe('A bank synchronization is already in progress.');
				await expect(app.get(BankingSyncService).synchronizeAutomatically(connection.id)).rejects.toMatchObject(
					{status: 409, message: 'A bank synchronization is already in progress.'},
				);
				await verifiedAgent
					.delete(`/bank-connections/${connection.id}`)
					.send({confirmation: 'DELETE'})
					.expect(409);
				expect(getAccountTransactions).toHaveBeenCalledTimes(1);
				if (entry === 'automatic') expect(getAccountTransactions.mock.calls[0]).toHaveLength(3);
				releaseProvider();
				expect(await active).toMatchObject({status: 'SUCCEEDED', finishedAt: expect.anything()});
				expect(await bankSyncRunRepository.countBy({bankConnection: {id: connection.id}})).toBe(1);
			} finally {
				releaseProvider?.();
				await active;
				await bankConnectionRepository.delete(connection.id);
			}
		},
	);

	it('refuses manual refresh when consent has expired, even right after a sync', async () => {
		const {connection} = await createAuthorizedConnection('manual-refresh-expired');
		await bankConnectionRepository.update(connection.id, {
			consentValidUntil: new Date(Date.now() - 1000),
			nextSyncAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
			lastSyncedAt: new Date(),
		});
		getAspsps.mockClear();
		getSessionAccounts.mockClear();
		try {
			const response = await verifiedAgent
				.post(`/bank-connections/${connection.id}/refresh`)
				.set('Origin', 'http://localhost:5173')
				.expect(409);
			expect(response.body.message).toBe('Bank consent has expired. Please reconnect.');
			expect(await bankConnectionRepository.findOneByOrFail({id: connection.id})).toMatchObject({
				status: 'EXPIRED',
				syncStatus: 'EXPIRED',
				nextSyncAt: null,
			});
			expect(await bankSyncRunRepository.countBy({bankConnection: {id: connection.id}})).toBe(0);
			expect(getAspsps).not.toHaveBeenCalled();
			expect(getSessionAccounts).not.toHaveBeenCalled();
		} finally {
			await bankConnectionRepository.delete(connection.id);
		}
	});

	it.each(['PARTIAL', 'FAILED'] as const)(
		'returns a finished %s manual refresh with stored successful endpoint data',
		async (status) => {
			const {connection, bankAccount} = await createAuthorizedConnection(`manual-refresh-${status}`);
			if (status === 'FAILED')
				getSessionAccounts.mockRejectedValueOnce(new EnableBankingClientError('provider_unreachable', 502));
			getAccountBalances.mockRejectedValueOnce(new EnableBankingClientError('provider_unreachable', 502));
			if (status === 'PARTIAL') getAccountTransactions.mockResolvedValueOnce(makeTransactions('manual-partial'));
			else
				getAccountTransactions.mockRejectedValueOnce(new EnableBankingClientError('provider_unreachable', 502));
			try {
				const response = await verifiedAgent
					.post(`/bank-connections/${connection.id}/refresh`)
					.set('Origin', 'http://localhost:5173')
					.set('User-Agent', 'ExampleBrowser/1.0')
					.expect(200);
				expect(response.body).toMatchObject({
					status,
					finishedAt: expect.any(String),
					transactionsAdded: status === 'PARTIAL' ? 5 : 0,
					rateLimitSource: null,
					retryAfterSeconds: null,
					errorMessage:
						status === 'PARTIAL'
							? 'Some bank data could not be synchronized.'
							: 'Bank synchronization failed.',
				});
				expect(await bankSyncRunRepository.findOneByOrFail({id: response.body.id})).toMatchObject({
					status,
					finishedAt: expect.any(Date),
				});
				expect(await bankTransactionRepository.countBy({bankAccountId: bankAccount.id})).toBe(
					status === 'PARTIAL' ? 5 : 0,
				);
				const saved = await bankConnectionRepository.findOneByOrFail({id: connection.id});
				expect(saved.syncStatus).toBe(status);
				expect(JSON.stringify(saved)).not.toContain('ExampleBrowser/1.0');
			} finally {
				await bankConnectionRepository.delete(connection.id);
			}
		},
	);

	it('rejects destructive removal while synchronization owns the connection lock', async () => {
		const {connection} = await createAuthorizedConnection('delete-while-sync-locked');
		const lockKey = `banking:sync:${connection.id}`;

		try {
			await redis.set(lockKey, 'active-sync', 'EX', 60);
			await verifiedAgent.delete(`/bank-connections/${connection.id}`).send({confirmation: 'DELETE'}).expect(409);
			expect(await bankConnectionRepository.findOneBy({id: connection.id})).not.toBeNull();
		} finally {
			await redis.del(lockKey);
			await bankConnectionRepository.delete(connection.id);
		}
	});

	it('cancels pending reauthorization before removing its existing connection', async () => {
		const {connection} = await createAuthorizedConnection('delete-reauthorization-race');
		const state = await authorize();

		const pendingConnection = await bankConnectionRepository.findOne({
			where: {account: {id: account.id}, status: 'PENDING_AUTHORIZATION'},
			order: {createdAt: 'DESC'},
		});
		if (!pendingConnection) throw new Error('Pending connection was not persisted.');

		await verifiedAgent.delete(`/bank-connections/${connection.id}`).send({confirmation: 'DELETE'}).expect(204);
		expect(await bankConnectionRepository.findOneBy({id: pendingConnection.id})).toMatchObject({
			status: 'CANCELLED',
			authorizationStateHash: null,
		});
		expect(await redis.exists(`banking:authorization:${state}`)).toBe(0);

		const createSessionCallCount = createSession.mock.calls.length;
		await callback({state, code: 'late-reauthorization-code'}, 'error');
		expect(createSession).toHaveBeenCalledTimes(createSessionCallCount);
		await bankConnectionRepository.delete(pendingConnection.id);
	});

	it('cleans all pending reauthorizations when removing an existing connection', async () => {
		const {connection} = await createAuthorizedConnection('delete-multiple-reauthorizations');
		const states: string[] = [];
		let pendingConnections: BankConnection[] = [];

		try {
			states.push(await authorize(), await authorize());

			pendingConnections = await bankConnectionRepository.find({
				where: {account: {id: account.id}, status: 'PENDING_AUTHORIZATION'},
				order: {createdAt: 'ASC'},
			});
			expect(pendingConnections).toHaveLength(2);

			await verifiedAgent.delete(`/bank-connections/${connection.id}`).send({confirmation: 'DELETE'}).expect(204);

			expect(await bankConnectionRepository.findOneBy({id: connection.id})).toBeNull();
			for (const pendingConnection of pendingConnections) {
				expect(await bankConnectionRepository.findOneBy({id: pendingConnection.id})).toMatchObject({
					status: 'CANCELLED',
					authorizationStateHash: null,
				});
			}
			for (const state of states) expect(await redis.exists(`banking:authorization:${state}`)).toBe(0);
		} finally {
			for (const pendingConnection of pendingConnections)
				await bankConnectionRepository.delete(pendingConnection.id);
			await bankConnectionRepository.delete(connection.id);
			for (const state of states) await redis.del(`banking:authorization:${state}`);
		}
	});

	it('removes owned incomplete connections without allowing unauthorized data deletion', async () => {
		const incompleteConnections: BankConnection[] = [];
		let pendingWithAccount: BankConnection | undefined;

		try {
			const pendingConnection = await createIncompleteConnection('PENDING_AUTHORIZATION');
			incompleteConnections.push(pendingConnection);

			await verifiedAgent.delete(`/bank-connections/${pendingConnection.id}`).expect(204);
			expect(await bankConnectionRepository.findOneBy({id: pendingConnection.id})).toBeNull();

			for (const status of ['FAILED', 'CANCELLED']) {
				const connection = await createIncompleteConnection(status);
				incompleteConnections.push(connection);

				await verifiedAgent.delete(`/bank-connections/${connection.id}`).expect(204);
				expect(await bankConnectionRepository.findOneBy({id: connection.id})).toBeNull();
			}

			pendingWithAccount = await createIncompleteConnection('PENDING_AUTHORIZATION');
			await fixtures.createBankAccount(pendingWithAccount, {name: 'Pending child account'});
			await verifiedAgent.delete(`/bank-connections/${pendingWithAccount.id}`).expect(409);
			expect(await bankConnectionRepository.findOneBy({id: pendingWithAccount.id})).not.toBeNull();
		} finally {
			for (const connection of incompleteConnections) await bankConnectionRepository.delete(connection.id);
			if (pendingWithAccount) await bankConnectionRepository.delete(pendingWithAccount.id);
		}
	});

	it('permanently removes an authorized connection and cascades its bank data', async () => {
		const {connection, bankAccount} = await createAuthorizedConnection('delete-authorized-cascade');
		await fixtures.createTransaction(bankAccount, {providerTransactionId: 'delete-authorized-transaction'});
		const syncRun = await fixtures.createSyncRun(connection);

		await otherVerifiedAgent.delete(`/bank-connections/${connection.id}`).expect(404);
		await verifiedAgent.delete(`/bank-connections/${connection.id}`).expect(400);
		await verifiedAgent.delete(`/bank-connections/${connection.id}`).send({confirmation: 'DELETE ME'}).expect(400);
		expect(await bankConnectionRepository.findOneBy({id: connection.id})).not.toBeNull();
		expect(await bankAccountRepository.findOneBy({id: bankAccount.id})).not.toBeNull();

		await verifiedAgent.delete(`/bank-connections/${connection.id}`).send({confirmation: 'DELETE'}).expect(204);

		expect(await bankConnectionRepository.findOneBy({id: connection.id})).toBeNull();
		expect(await bankAccountRepository.findOneBy({id: bankAccount.id})).toBeNull();
		expect(
			await bankTransactionRepository.findOneBy({providerTransactionId: 'delete-authorized-transaction'}),
		).toBeNull();
		expect(await bankSyncRunRepository.findOneBy({id: syncRun.id})).toBeNull();
	});

	it('removes the pending authorization state with an incomplete connection', async () => {
		const state = await authorize();

		const pendingConnection = await bankConnectionRepository.findOne({
			where: {account: {id: account.id}, status: 'PENDING_AUTHORIZATION'},
			order: {createdAt: 'DESC'},
		});
		if (!pendingConnection) throw new Error('Pending connection was not persisted.');
		const stateKey = `banking:authorization:${state}`;

		try {
			expect(await redis.exists(stateKey)).toBe(1);
			await verifiedAgent.delete(`/bank-connections/${pendingConnection.id}`).expect(204);
			expect(await redis.exists(stateKey)).toBe(0);
			expect(await bankConnectionRepository.findOneBy({id: pendingConnection.id})).toBeNull();
		} finally {
			await bankConnectionRepository.delete(pendingConnection.id);
			await redis.del(stateKey);
		}
	});

	it('validates the requested ASPSP', async () => {
		await verifiedAgent
			.post('/bank-connections/authorize')
			.send({aspspName: 'ABN AMRO', aspspCountry: 'NLD'})
			.expect(400);

		getAspsps.mockResolvedValueOnce([]);
		await verifiedAgent
			.post('/bank-connections/authorize')
			.send({aspspName: 'Unknown Bank', aspspCountry: 'NL'})
			.expect(400);
	});

	it('lists supported ASPSPs without exposing provider metadata', async () => {
		getAspsps.mockResolvedValueOnce([
			{
				name: 'Revolut',
				country: 'NL',
				logoUrl: 'https://enablebanking.com/brands/NL/Revolut/',
				maximumConsentValiditySeconds: 86_400,
			},
			{
				name: 'Nordea',
				country: 'FI',
				logoUrl: 'https://enablebanking.com/brands/FI/Nordea/',
				maximumConsentValiditySeconds: 86_400,
			},
			{name: 'Revolut', country: 'NL', maximumConsentValiditySeconds: 86_400},
			{
				name: 'ABN AMRO',
				country: 'NL',
				logoUrl: 'https://enablebanking.com/brands/NL/ABN-AMRO/',
				maximumConsentValiditySeconds: 86_400,
			},
		]);

		const response = await verifiedAgent.get('/bank-connections/aspsps').expect(200);

		expect(response.body).toEqual([
			{name: 'Nordea', country: 'FI', logoUrl: 'https://enablebanking.com/brands/FI/Nordea/'},
			{name: 'ABN AMRO', country: 'NL', logoUrl: 'https://enablebanking.com/brands/NL/ABN-AMRO/'},
			{name: 'Revolut', country: 'NL', logoUrl: 'https://enablebanking.com/brands/NL/Revolut/'},
		]);
		expect(JSON.stringify(response.body)).not.toContain('maximumConsentValiditySeconds');
	});

	it('returns a sanitized error when supported ASPSPs cannot be loaded', async () => {
		getAspsps.mockRejectedValueOnce(new EnableBankingClientError('secret-provider-error'));

		const response = await verifiedAgent.get('/bank-connections/aspsps').expect(502);

		expect(response.body.message).toBe('Unable to load supported banks.');
		expect(JSON.stringify(response.body)).not.toContain('secret-provider-error');
	});

	it('persists a successful authorization without exposing sensitive provider values', async () => {
		const sessionId = 'provider-session-success';
		createSession.mockResolvedValueOnce({
			sessionId,
			consentValidUntil: '2030-01-01T00:00:00.000Z',
			aspsp: {name: 'ABN AMRO', country: 'NL'},
			accounts: [
				{
					uid: 'provider-account-success',
					identificationHash: 'stable-account-hash-success',
					name: 'Joe',
					details: 'Main account',
					currency: ' eUr ',
					cashAccountType: 'CACC',
					usage: 'PRIV',
				},
			],
		});

		const authorizationResponse = await verifiedAgent
			.post('/bank-connections/authorize')
			.send({aspspName: 'ABN AMRO', aspspCountry: 'NL'})
			.expect(201);
		const state = startAuthorization.mock.calls.at(-1)?.[0].state;
		expect(authorizationResponse.body).toEqual({authorizationUrl: 'https://auth.example.test/authorize'});
		expect(state).toEqual(expect.any(String));

		await callback({state, code: 'one-time-provider-code'}, 'connected');

		const connection = await bankConnectionRepository.findOne({
			where: {account: {id: account.id}},
			order: {createdAt: 'DESC'},
		});
		if (!connection) throw new Error('Bank connection was not persisted.');
		const bankAccount = await bankAccountRepository.findOne({
			where: {bankConnection: {id: connection.id}},
		});

		expect(connection.status).toBe('AUTHORIZED');
		expect(connection.providerSessionId).toBeDefined();
		expect(connection.providerSessionId).not.toBe(sessionId);
		expect(bankAccount).toMatchObject({
			providerAccountId: 'provider-account-success',
			identificationHash: 'stable-account-hash-success',
			currency: 'EUR',
			name: 'Joe',
			details: 'Main account',
		});
		expect(bankAccount?.currentBalanceAmount).toBeNull();

		const response = await verifiedAgent.get('/bank-connections').expect(200);
		expect(response.body).toEqual([
			expect.objectContaining({
				id: connection.id,
				status: 'AUTHORIZED',
				bankAccounts: [
					expect.objectContaining({
						name: 'Joe',
						currency: 'EUR',
					}),
				],
			}),
		]);
		expect(JSON.stringify(response.body)).not.toContain('providerSessionId');
		expect(JSON.stringify(response.body)).not.toContain('stable-account-hash-success');
		expect(JSON.stringify(response.body)).not.toContain('provider-account-success');
	});

	it('handles cancellation and prevents callback replay', async () => {
		const cancelledState = await authorize();

		await callback(
			{state: cancelledState, error: 'access_denied', error_description: 'do not persist this'},
			'cancelled',
		);

		const cancelledConnection = await bankConnectionRepository.findOne({
			where: {account: {id: account.id}},
			order: {createdAt: 'DESC'},
		});
		expect(cancelledConnection?.status).toBe('CANCELLED');

		const successfulResponse = await verifiedAgent
			.post('/bank-connections/authorize')
			.send({aspspName: 'ABN AMRO', aspspCountry: 'NL'})
			.expect(201);
		const successfulState = startAuthorization.mock.calls.at(-1)?.[0].state;
		createSession.mockResolvedValueOnce({
			sessionId: 'provider-session-replay-test',
			consentValidUntil: '2030-01-01T00:00:00.000Z',
			aspsp: {name: 'ABN AMRO', country: 'NL'},
			accounts: [],
		});

		await callback({state: successfulState, code: 'replay-test-code'}, 'connected');

		const successfulConnection = await bankConnectionRepository.findOne({
			where: {account: {id: account.id}, status: 'AUTHORIZED'},
			order: {createdAt: 'DESC'},
		});
		if (!successfulConnection) throw new Error('Successful authorization connection was not persisted.');
		const encryptedProviderSessionId = successfulConnection.providerSessionId;

		await callback({state: successfulState, code: 'replay-test-code'}, 'error');
		expect(successfulResponse.body).toEqual({authorizationUrl: 'https://auth.example.test/authorize'});

		const replayedConnection = await bankConnectionRepository.findOneBy({id: successfulConnection.id});
		expect(replayedConnection).toMatchObject({
			status: 'AUTHORIZED',
			providerSessionId: encryptedProviderSessionId,
			authorizationStateHash: null,
		});
	});

	it('rejects an expired authorization state', async () => {
		const state = await authorize();

		await redis.expire(`banking:authorization:${state}`, 1);
		await new Promise((resolve) => setTimeout(resolve, 1100));

		await callback({state, code: 'expired-provider-code'}, 'error');
		expect(createSession).not.toHaveBeenCalledWith('expired-provider-code');

		const expiredConnection = await bankConnectionRepository.findOne({
			where: {account: {id: account.id}},
			order: {createdAt: 'DESC'},
		});
		expect(expiredConnection?.status).toBe('FAILED');
	});

	it('marks provider failures as failed without leaking provider details', async () => {
		const state = await authorize();
		createSession.mockRejectedValueOnce(new EnableBankingClientError('secret-provider-error'));

		await callback({state, code: 'provider-failure-code'}, 'error');

		const connection = await bankConnectionRepository.findOne({
			where: {account: {id: account.id}},
			order: {createdAt: 'DESC'},
		});
		expect(connection?.status).toBe('FAILED');
	});

	it('rolls back the connection transaction when bank-account persistence fails', async () => {
		const state = await authorize();
		createSession.mockResolvedValueOnce({
			sessionId: 'provider-session-rollback-test',
			consentValidUntil: '2030-01-01T00:00:00.000Z',
			aspsp: {name: 'ABN AMRO', country: 'NL'},
			accounts: [
				{
					uid: 'provider-account-before-failure',
					identificationHash: 'stable-account-before-failure',
					currency: 'EUR',
				},
				{
					uid: 'provider-account-invalid',
					identificationHash: 'stable-account-invalid',
					currency: 'USDD',
				},
			],
		});

		await callback({state, code: 'rollback-test-code'}, 'error');

		const connection = await bankConnectionRepository.findOne({
			where: {account: {id: account.id}},
			order: {createdAt: 'DESC'},
		});
		if (!connection) throw new Error('Bank connection was not persisted.');

		expect(connection.status).toBe('FAILED');
		expect(connection.providerSessionId).toBeNull();
		expect(await bankAccountRepository.count({where: {bankConnection: {id: connection.id}}})).toBe(0);
	});

	it('merges re-authorization into the existing connection instead of duplicating it', async () => {
		await bankConnectionRepository
			.createQueryBuilder()
			.delete()
			.where('accountId = :accountId', {accountId: account.id})
			.execute();

		const firstState = await authorize();
		createSession.mockResolvedValueOnce({
			sessionId: 'provider-session-reauth-original',
			consentValidUntil: '2030-01-01T00:00:00.000Z',
			aspsp: {name: 'ABN AMRO', country: 'NL'},
			accounts: [
				{
					uid: 'provider-account-original',
					identificationHash: 'stable-account-reauth',
					iban: 'NL91ABNA0417164300',
					currency: 'EUR',
				},
			],
		});
		await request(httpServer)
			.get('/bank-connections/callback')
			.query({state: firstState, code: 'reauth-original-code'})
			.expect(302);

		const originalConnection = (
			await bankConnectionRepository.find({
				where: {account: {id: account.id}, status: 'AUTHORIZED'},
				order: {createdAt: 'DESC'},
			})
		)[0];
		if (!originalConnection) throw new Error('Authorized connection was not persisted.');
		const originalBankAccount = await bankAccountRepository.findOne({
			where: {bankConnection: {id: originalConnection.id}},
		});
		if (!originalBankAccount) throw new Error('Bank account was not persisted.');
		expect(originalBankAccount.iban).toBe('NL91ABNA0417164300');

		const secondState = await authorize();
		createSession.mockResolvedValueOnce({
			sessionId: 'provider-session-reauth-refreshed',
			consentValidUntil: '2031-01-01T00:00:00.000Z',
			aspsp: {name: 'ABN AMRO', country: 'NL'},
			accounts: [
				{
					// Enable Banking rotates the session-scoped uid; the identification hash is stable.
					uid: 'provider-account-rotated',
					identificationHash: 'stable-account-reauth',
					currency: 'EUR',
				},
			],
		});
		await callback({state: secondState, code: 'reauth-refreshed-code'}, 'connected');

		const authorizedConnections = await bankConnectionRepository.find({
			where: {account: {id: account.id}, status: 'AUTHORIZED'},
		});
		expect(authorizedConnections).toHaveLength(1);
		expect(authorizedConnections[0].id).toBe(originalConnection.id);
		expect(authorizedConnections[0].consentValidUntil?.getTime()).toBeGreaterThan(
			originalConnection.consentValidUntil?.getTime() ?? 0,
		);

		const refreshedBankAccounts = await bankAccountRepository.find({
			where: {bankConnection: {id: originalConnection.id}},
		});
		expect(refreshedBankAccounts).toHaveLength(1);
		expect(refreshedBankAccounts[0].id).toBe(originalBankAccount.id);
		expect(refreshedBankAccounts[0].providerAccountId).toBe('provider-account-rotated');
		expect(refreshedBankAccounts[0].identificationHash).toBe('stable-account-reauth');
		// The refreshed session reported no IBAN; the stored one is kept.
		expect(refreshedBankAccounts[0].iban).toBe('NL91ABNA0417164300');
	});

	it('keeps the live connection untouched when re-authorization is cancelled', async () => {
		await bankConnectionRepository
			.createQueryBuilder()
			.delete()
			.where('accountId = :accountId', {accountId: account.id})
			.execute();
		const {connection} = await createAuthorizedConnection('cancel-reauth-session');
		const encryptedSessionId = connection.providerSessionId;

		const cancelledState = await authorize();
		await callback({state: cancelledState, error: 'access_denied'}, 'cancelled');

		const liveConnection = await bankConnectionRepository.findOneBy({id: connection.id});
		expect(liveConnection).toMatchObject({status: 'AUTHORIZED', providerSessionId: encryptedSessionId});
		expect(await bankAccountRepository.count({where: {bankConnection: {id: connection.id}}})).toBe(1);
	});

	it('refreshes an expired connection on re-authorization', async () => {
		await bankConnectionRepository
			.createQueryBuilder()
			.delete()
			.where('accountId = :accountId', {accountId: account.id})
			.execute();
		const {connection} = await createAuthorizedConnection('expired-reauth-session');

		await bankConnectionRepository.update(
			{id: connection.id},
			{status: 'EXPIRED', consentValidUntil: new Date(Date.now() - 60 * 60 * 1000)},
		);

		const state = await authorize();
		createSession.mockResolvedValueOnce({
			sessionId: 'provider-session-revived',
			consentValidUntil: '2031-06-01T00:00:00.000Z',
			aspsp: {name: 'ABN AMRO', country: 'NL'},
			accounts: [
				{uid: 'provider-account-revived', identificationHash: 'hash-expired-reauth-session', currency: 'EUR'},
			],
		});
		await callback({state, code: 'revive-code'}, 'connected');

		const authorizedConnections = await bankConnectionRepository.find({
			where: {account: {id: account.id}, status: 'AUTHORIZED'},
		});
		expect(authorizedConnections).toHaveLength(1);
		expect(authorizedConnections[0].id).toBe(connection.id);
		expect(await bankAccountRepository.count({where: {bankConnection: {id: connection.id}}})).toBe(1);
	});

	it('does not expose one account owner’s connections to another account', async () => {
		const response = await otherVerifiedAgent.get('/bank-connections').expect(200);
		expect(response.body).toEqual([]);
	});

	it('returns balances in the owner’s base currency from stored ECB rates', async () => {
		const fxRates = app.get(DataSource).getRepository(BankTransactionFxRate);
		const accounts = app.get(DataSource).getRepository(Account);
		const connection = await fixtures.createConnection(account);
		const [euro, dollar, pound, franc, unknown] = await fixtures.createBankAccounts(connection, [
			{currency: 'EUR', currentBalanceAmount: '123.45000000'},
			{currency: 'USD', currentBalanceAmount: '-100.00500000'},
			{currency: 'GBP', currentBalanceAmount: '-100.00000000'},
			{currency: 'CHF', currentBalanceAmount: '50.00000000'},
			{currency: 'USD', currentBalanceAmount: null},
		]);
		// Other suites may leave stored rates behind.
		await fxRates.delete({currency: In(['USD', 'GBP', 'CHF'])});
		// GBP and USD dates differ, so a cross rate must use the newest date both were published.
		const rates = await fxRates.save([
			{currency: 'USD', rateDate: '2026-09-01', rateToEur: '1.2', provider: 'ECB'},
			{currency: 'USD', rateDate: '2026-09-02', rateToEur: '1.25', provider: 'ECB'},
			{currency: 'USD', rateDate: '2999-01-01', rateToEur: '9', provider: 'ECB'},
			{currency: 'GBP', rateDate: '2026-09-01', rateToEur: '0.8', provider: 'ECB'},
			{currency: 'GBP', rateDate: '2026-09-03', rateToEur: '0.85', provider: 'ECB'},
		]);
		const balancesOf = async () => {
			const response = await verifiedAgent.get('/bank-connections').expect(200);
			const listed = response.body.find(({id}: {id: string}) => id === connection.id);
			return {
				baseCurrency: listed.baseCurrency,
				accounts: Object.fromEntries(
					listed.bankAccounts.map(
						(bankAccount: {
							id: string;
							currentBalanceInBaseCurrency: string;
							baseCurrencyRateDate: string;
						}) => [
							bankAccount.id,
							[bankAccount.currentBalanceInBaseCurrency, bankAccount.baseCurrencyRateDate],
						],
					),
				),
			};
		};

		try {
			await accounts.update({id: account.id}, {baseCurrency: null});
			expect(await balancesOf()).toEqual({
				baseCurrency: null,
				accounts: {
					[euro.id]: [null, null],
					[dollar.id]: [null, null],
					[pound.id]: [null, null],
					[franc.id]: [null, null],
					[unknown.id]: [null, null],
				},
			});

			await accounts.update({id: account.id}, {baseCurrency: 'EUR'});
			expect(await balancesOf()).toEqual({
				baseCurrency: 'EUR',
				accounts: {
					[euro.id]: ['123.45', null],
					[dollar.id]: ['-80.00', '2026-09-02'],
					[pound.id]: ['-117.65', '2026-09-03'],
					[franc.id]: [null, null],
					[unknown.id]: [null, null],
				},
			});

			await accounts.update({id: account.id}, {baseCurrency: 'USD'});
			expect(await balancesOf()).toEqual({
				baseCurrency: 'USD',
				accounts: {
					[euro.id]: ['154.31', '2026-09-02'],
					[dollar.id]: ['-100.01', null],
					[pound.id]: ['-150.00', '2026-09-01'],
					[franc.id]: [null, null],
					[unknown.id]: [null, null],
				},
			});
		} finally {
			await accounts.update({id: account.id}, {baseCurrency: null});
			await fxRates.delete(rates.map(({id}) => id));
			await bankConnectionRepository.delete({id: connection.id});
		}
	});

	it('enforces ownership and UUID validation for transaction reads', async () => {
		const {connection} = await createAuthorizedConnection('transaction-access-check');
		const transactionPath = `/bank-connections/${connection.id}/transactions`;

		await otherVerifiedAgent.get(transactionPath).expect(404);
		await verifiedAgent.get('/bank-connections/not-a-uuid/transactions').expect(400);
	});

	it('reconciles a pending payment when booking populates valueDate without losing manual category', async () => {
		const {connection, bankAccount} = await createAuthorizedConnection('pending-booked-session');
		const pendingProviderShape = makeTransactions('pending-booked')[0];
		const pending: EnableBankingTransaction = {
			...pendingProviderShape,
			// EnableBankingClient fills a missing provider value_date from transaction_date.
			valueDate: pendingProviderShape.transactionDate,
			status: 'PDNG',
		};
		const synchronize = (transaction: EnableBankingTransaction) => synchronizeQueued(connection.id, [transaction]);
		expect(await synchronize(pending)).toMatchObject({status: 'SUCCEEDED', transactionsAdded: 1});
		const stored = await bankTransactionRepository.findOneByOrFail({bankAccountId: bankAccount.id});
		await bankTransactionRepository.update(stored.id, {
			category: 'GROCERIES',
			categorySource: 'MANUAL',
			categoryStatus: 'COMPLETED',
		});
		const booked = {...pending, status: 'BOOK', valueDate: '2026-08-27'};
		expect(await synchronize(booked)).toMatchObject({status: 'SUCCEEDED', transactionsAdded: 0});
		expect(await synchronize(booked)).toMatchObject({status: 'SUCCEEDED', transactionsAdded: 0});
		const rows = await bankTransactionRepository.findBy({bankAccountId: bankAccount.id});
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			id: stored.id,
			stableIdentityKey: stored.stableIdentityKey,
			transactionDate: '2026-08-24',
			bookingDate: '2026-08-26',
			transactionStatus: 'BOOK',
			valueDate: '2026-08-27',
			category: 'GROCERIES',
			categorySource: 'MANUAL',
			categoryStatus: 'COMPLETED',
		});
		const response = await verifiedAgent.get(`/bank-connections/${connection.id}/transactions`).expect(200);
		expect(response.body.transactions).toHaveLength(1);
		expect(response.body.transactions[0].id).toBe(stored.id);
	});

	it('stores amounts already in the base currency when a sync saves them', async () => {
		const {connection, bankAccount} = await createAuthorizedConnection('same-currency-base-amount-session');
		const [euro, dollar] = makeTransactions('same-currency-base-amount');
		const foreign = {...dollar, currency: 'USD', instructedAmount: undefined, instructedCurrency: undefined};
		const accounts = app.get(DataSource).getRepository(Account);
		await accounts.update({id: account.id}, {baseCurrency: 'EUR'});
		try {
			expect(await synchronizeQueued(connection.id, [euro, foreign])).toMatchObject({
				status: 'SUCCEEDED',
				transactionsAdded: 2,
			});
		} finally {
			await accounts.update({id: account.id}, {baseCurrency: null});
		}

		const rows = await bankTransactionRepository.findBy({bankAccountId: bankAccount.id});
		expect(rows.find(({currency}) => currency === 'EUR')).toMatchObject({
			amountInBaseCurrency: '-12.50',
			baseAmountMethod: 'SAME',
			baseAmountRateDate: null,
		});
		// Foreign amounts still wait for their ECB rate.
		expect(rows.find(({currency}) => currency === 'USD')).toMatchObject({
			amountInBaseCurrency: null,
			baseAmountMethod: null,
		});
	});

	it('clears a stored base amount when a re-sync changes its conversion inputs', async () => {
		const {connection, bankAccount} = await createAuthorizedConnection('conversion-input-change-session');
		const [changing, unchanged] = makeTransactions('conversion-input-change');
		const synchronize = (transactions: EnableBankingTransaction[]) =>
			synchronizeQueued(connection.id, transactions);
		expect(await synchronize([changing, unchanged])).toMatchObject({status: 'SUCCEEDED', transactionsAdded: 2});
		const converted = {
			amountInBaseCurrency: '-11.00',
			baseAmountMethod: 'INSTRUCTED' as const,
			baseAmountRateDate: null,
		};
		await bankTransactionRepository.update({bankAccountId: bankAccount.id}, converted);

		const corrected = {...changing, instructedAmount: '13.00', instructedCurrency: 'EUR'};
		expect(await synchronize([corrected, unchanged])).toMatchObject({status: 'SUCCEEDED', transactionsAdded: 0});

		const rows = await bankTransactionRepository.findBy({bankAccountId: bankAccount.id});
		expect(rows).toHaveLength(2);
		expect(rows.find(({entryReference}) => entryReference === changing.entryReference)).toMatchObject({
			instructedAmount: '13.00000000',
			instructedCurrency: 'EUR',
			amountInBaseCurrency: null,
			baseAmountMethod: null,
			baseAmountRateDate: null,
		});
		expect(rows.find(({entryReference}) => entryReference === unchanged.entryReference)).toMatchObject(converted);
	});

	it.each([
		['different-reference pending payment', 'payment-b'],
		['missing-reference stale pending input', undefined],
		['same-reference stale pending input', 'payment-a'],
	])('reserves the booked owner identity key for %s', async (_scenario, entryReference) => {
		const {connection, bankAccount} = await createAuthorizedConnection('reserved-booked-key-session');
		const pending: EnableBankingTransaction = {
			...makeTransactions('reserved-booked-key')[0],
			providerTransactionId: undefined,
			entryReference: 'payment-a',
			transactionDate: undefined,
			valueDate: undefined,
			status: 'PDNG',
		};
		const synchronize = (transaction: EnableBankingTransaction) => synchronizeQueued(connection.id, [transaction]);
		expect(await synchronize(pending)).toMatchObject({status: 'SUCCEEDED', transactionsAdded: 1});
		const stored = await bankTransactionRepository.findOneByOrFail({bankAccountId: bankAccount.id});
		await bankTransactionRepository.update(stored.id, {
			category: 'GROCERIES',
			categorySource: 'MANUAL',
			categoryStatus: 'COMPLETED',
		});
		expect(await synchronize({...pending, status: 'BOOK', valueDate: '2026-08-27'})).toMatchObject({
			status: 'SUCCEEDED',
			transactionsAdded: 0,
		});
		const booked = await bankTransactionRepository.findOneByOrFail({id: stored.id});
		expect(booked).toMatchObject({
			stableIdentityKey: stored.stableIdentityKey,
			transactionStatus: 'BOOK',
			valueDate: '2026-08-27',
			category: 'GROCERIES',
			categorySource: 'MANUAL',
			categoryStatus: 'COMPLETED',
		});
		expect(booked.stableIdentityGroupKey).not.toBe(stored.stableIdentityGroupKey);

		expect(await synchronize({...pending, entryReference})).toMatchObject({
			status: 'SUCCEEDED',
			transactionsAdded: 1,
		});
		const rows = await bankTransactionRepository.findBy({bankAccountId: bankAccount.id});
		expect(rows).toHaveLength(2);
		expect(await bankTransactionRepository.findOneByOrFail({id: stored.id})).toEqual(booked);
		const newPending = rows.find(({id}) => id !== stored.id)!;
		expect(newPending).toMatchObject({
			entryReference: entryReference ?? null,
			transactionStatus: 'PDNG',
			valueDate: null,
			stableIdentityGroupKey: stored.stableIdentityGroupKey,
		});
		expect(newPending.stableIdentityKey).not.toBe(booked.stableIdentityKey);
		expect(await synchronize({...pending, entryReference})).toMatchObject({
			status: 'SUCCEEDED',
			transactionsAdded: 0,
		});
		expect(await bankTransactionRepository.countBy({bankAccountId: bankAccount.id})).toBe(2);
		expect(await bankTransactionRepository.findOneByOrFail({id: stored.id})).toEqual(booked);
	});

	it('preserves ambiguous repeated pending payments when one booked occurrence arrives', async () => {
		const {connection, bankAccount} = await createAuthorizedConnection('ambiguous-pending-session');
		const pending: EnableBankingTransaction = {
			...makeTransactions('ambiguous-pending')[0],
			providerTransactionId: undefined,
			transactionDate: undefined,
			valueDate: undefined,
			status: 'PDNG',
		};
		getAccountBalances.mockResolvedValueOnce(makeBalances());
		getAccountTransactions.mockResolvedValueOnce([pending, pending]);
		expect(await app.get(BankingSyncService).synchronizeAutomatically(connection.id)).toMatchObject({
			status: 'SUCCEEDED',
			transactionsAdded: 2,
		});
		const stored = await bankTransactionRepository.findBy({bankAccountId: bankAccount.id});
		getAccountBalances.mockResolvedValueOnce(makeBalances());
		getAccountTransactions.mockResolvedValueOnce([{...pending, status: 'BOOK', valueDate: '2026-08-27'}]);
		expect(await synchronizeDue(connection.id)).toMatchObject({
			status: 'SUCCEEDED',
			transactionsAdded: 1,
		});
		const rows = await bankTransactionRepository.findBy({bankAccountId: bankAccount.id});
		expect(rows).toHaveLength(3);
		expect(
			rows
				.filter(({transactionStatus}) => transactionStatus === 'PDNG')
				.map(({id}) => id)
				.sort(),
		).toEqual(stored.map(({id}) => id).sort());
	});

	it('normalizes incoming currency and direction codes before persisting a sync', async () => {
		const {connection, bankAccount} = await createAuthorizedConnection('canonical-codes-session');
		getAccountBalances.mockResolvedValueOnce(makeBalances().map((balance) => ({...balance, currency: ' eUr '})));
		getAccountTransactions.mockResolvedValueOnce([
			{
				...makeTransactions('canonical-codes')[0],
				amount: '12.50',
				currency: ' eUr ',
				creditDebitIndicator: ' dbit ',
				balanceAfterCurrency: ' eUr ',
				instructedCurrency: ' uSd ',
				exchangeRateUnitCurrency: ' uSd ',
			},
		]);

		try {
			expect(await app.get(BankingSyncService).synchronizeAutomatically(connection.id)).toMatchObject({
				status: 'SUCCEEDED',
				transactionsAdded: 1,
			});
			expect(await bankTransactionRepository.findOneByOrFail({bankAccountId: bankAccount.id})).toMatchObject({
				amount: '-12.50000000',
				currency: 'EUR',
				creditDebitIndicator: 'DBIT',
				balanceAfterCurrency: 'EUR',
				instructedCurrency: 'USD',
				exchangeRateUnitCurrency: 'USD',
			});
			const balances = await bankAccountBalanceRepository.findBy({bankAccountId: bankAccount.id});
			expect(balances).toHaveLength(2);
			expect(balances.map(({currency}) => currency)).toEqual(['EUR', 'EUR']);
			const response = await verifiedAgent
				.get('/bank-transactions')
				.query({
					'filter[bankAccountIds][]': bankAccount.id,
					'filter[cashFlows][]': 'SPENDING',
				})
				.expect(200);
			expect(response.body.total).toBe(1);
		} finally {
			await bankConnectionRepository.delete(connection.id);
		}
	});

	it('synchronizes balances and transactions without exposing provider identifiers', async () => {
		const {connection, bankAccount} = await createAuthorizedConnection('sync-provider-session');
		await bankConnectionRepository.update(
			{id: connection.id},
			{nextSyncAt: new Date(Date.now() - 1), syncStatus: 'QUEUED'},
		);
		const balances = makeBalances();
		const transactions = makeTransactions('sync');
		const duplicateEntryReferenceDetails = {
			entryReference: transactions[0].entryReference,
			transactionDate: transactions[0].transactionDate,
			bookingDate: transactions[0].bookingDate,
			valueDate: transactions[0].valueDate,
			amount: transactions[0].amount,
			currency: transactions[0].currency,
			creditDebitIndicator: transactions[0].creditDebitIndicator,
			referenceNumber: 'reference-sync-1',
			referenceNumberScheme: 'RF',
		};
		transactions[1] = {...transactions[1], ...duplicateEntryReferenceDetails};
		getAccountBalances.mockResolvedValueOnce(balances);
		getAccountTransactions.mockResolvedValueOnce(transactions);

		const firstResponse = await app.get(BankingSyncService).synchronizeAutomatically(connection.id);
		if (!firstResponse) throw new Error('Expected automatic synchronization to run.');
		expect(firstResponse).toEqual(
			expect.objectContaining({
				status: 'SUCCEEDED',
				requestedFrom: null,
				accountsFetched: 1,
				balancesFetched: 2,
				transactionsFetched: 5,
				transactionsAdded: 5,
			}),
		);

		const persistedBalances = await bankAccountBalanceRepository.find({
			where: {bankAccountId: bankAccount.id},
			order: {balanceType: 'ASC'},
		});
		expect(persistedBalances).toHaveLength(2);

		const persistedTransactions = await bankTransactionRepository.find({
			where: {bankAccountId: bankAccount.id},
		});
		expect(persistedTransactions).toHaveLength(5);
		expect(new Set(persistedTransactions.map(({stableIdentityKey}) => stableIdentityKey)).size).toBe(5);
		expect(persistedTransactions.find(({creditDebitIndicator}) => creditDebitIndicator === 'DBIT')?.amount).toBe(
			'-12.50000000',
		);
		const firstPersistedTransaction = persistedTransactions.find(
			({referenceNumber}) => referenceNumber === 'reference-sync-0',
		);
		const secondPersistedTransaction = persistedTransactions.find(
			({referenceNumber}) => referenceNumber === 'reference-sync-1',
		);
		expect(firstPersistedTransaction).toBeDefined();
		expect(secondPersistedTransaction).toBeDefined();
		expect(firstPersistedTransaction?.stableIdentityGroupKey).toEqual(
			secondPersistedTransaction?.stableIdentityGroupKey,
		);
		expect(firstPersistedTransaction?.stableIdentityKey).not.toEqual(secondPersistedTransaction?.stableIdentityKey);
		if (!firstPersistedTransaction || !secondPersistedTransaction) {
			throw new Error('Expected the two repeated-reference transactions to persist.');
		}
		await bankTransactionRepository.update(
			{id: firstPersistedTransaction.id},
			{categorySource: 'MANUAL', categoryStatus: 'COMPLETED'},
		);
		await bankTransactionRepository.update(
			{id: secondPersistedTransaction.id},
			{categorySource: 'AI', categoryStatus: 'COMPLETED'},
		);
		expect(firstPersistedTransaction).toMatchObject({
			transactionDate: '2026-08-24',
			transactionType: 'CARD_PAYMENT',
			bankTransactionCode: 'PMNT',
			bankTransactionSubCode: 'CARD',
			bankTransactionDescription: 'Card payment',
			displayDescription: 'Provider description 0',
			balanceAfterAmount: '110.95000000',
			balanceAfterCurrency: 'EUR',
			instructedAmount: '12.00000000',
			instructedCurrency: 'USD',
			exchangeRate: '0.923400000000000000',
			exchangeRateUnitCurrency: 'USD',
			exchangeRateType: 'SPOT',
			referenceNumber: 'reference-sync-0',
			referenceNumberScheme: 'RF',
		});

		const refreshedAccount = await bankAccountRepository.findOneBy({id: bankAccount.id});
		expect(refreshedAccount).toMatchObject({
			currentBalanceAmount: '123.45000000',
			currentBalanceType: 'AVAILABLE',
		});

		const safeConnectionsResponse = await verifiedAgent.get('/bank-connections').expect(200);
		const safeConnection = safeConnectionsResponse.body.find(({id}: {id: string}) => id === connection.id);
		expect(safeConnection.bankAccounts[0].latestBalances).toEqual(
			expect.arrayContaining([
				expect.objectContaining({balanceType: 'AVAILABLE', amount: '123.45000000', isPrimary: true}),
				expect.objectContaining({balanceType: 'BOOKED', amount: '120.00000000', isPrimary: false}),
			]),
		);
		expect(JSON.stringify(safeConnectionsResponse.body)).not.toContain('sync-provider-session');
		expect(JSON.stringify(safeConnectionsResponse.body)).not.toContain('sync-provider-account');

		const transactionsResponse = await verifiedAgent
			.get(`/bank-connections/${connection.id}/transactions?limit=5`)
			.expect(200);
		expect(transactionsResponse.body.transactions).toHaveLength(5);
		expect(JSON.stringify(transactionsResponse.body)).not.toContain('provider-transaction-sync');
		expect(JSON.stringify(transactionsResponse.body)).not.toContain('provider-entry-sync');
		expect(transactionsResponse.body.transactions[0]).not.toHaveProperty('bankAccountId');

		const priorFirstStableIdentityKey = firstPersistedTransaction.stableIdentityKey;
		const priorFirstStableIdentityGroupKey = firstPersistedTransaction.stableIdentityGroupKey;
		await bankTransactionRepository.update(
			{id: firstPersistedTransaction.id},
			{stableIdentityKey: null, stableIdentityGroupKey: null, dedupeKey: 'a'.repeat(64)},
		);

		getAccountBalances.mockResolvedValueOnce(balances);
		const updatedTransactions = makeTransactions('sync');
		updatedTransactions[1] = {...updatedTransactions[1], ...duplicateEntryReferenceDetails};
		updatedTransactions[0] = {
			...updatedTransactions[0],
			providerTransactionId: 'provider-transaction-sync-0-refreshed',
			description: 'A'.repeat(81),
			counterpartyName: 'Updated Counterparty',
			bankTransactionDescription: 'Updated card payment',
			balanceAfterAmount: '111.95',
			referenceNumber: 'reference-sync-0-updated',
		};
		getAccountTransactions.mockResolvedValueOnce([
			updatedTransactions[1],
			updatedTransactions[0],
			...updatedTransactions.slice(2),
		]);
		await bankConnectionRepository.update(
			{id: connection.id},
			{nextSyncAt: new Date(Date.now() - 1), syncStatus: 'QUEUED'},
		);

		const secondResponse = await app.get(BankingSyncService).synchronizeAutomatically(connection.id);
		if (!secondResponse) throw new Error('Expected the incremental automatic synchronization to run.');
		expect(secondResponse).toEqual(
			expect.objectContaining({
				status: 'SUCCEEDED',
				requestedFrom: expect.any(String),
				requestedTo: expect.any(String),
				transactionsAdded: 0,
			}),
		);
		expect(await bankTransactionRepository.count({where: {bankAccountId: bankAccount.id}})).toBe(5);
		expect(await bankAccountBalanceRepository.count({where: {bankAccountId: bankAccount.id}})).toBe(4);
		const unchangedDuplicateEntryReferenceTransaction = await bankTransactionRepository.findOneBy({
			bankAccountId: bankAccount.id,
			referenceNumber: 'reference-sync-1',
		});
		expect(unchangedDuplicateEntryReferenceTransaction?.id).toBe(secondPersistedTransaction?.id);
		const updatedTransaction = await bankTransactionRepository.findOneBy({
			bankAccountId: bankAccount.id,
			referenceNumber: 'reference-sync-0-updated',
		});
		expect(updatedTransaction?.id).toBe(firstPersistedTransaction?.id);
		expect(updatedTransaction).toMatchObject({
			stableIdentityKey: priorFirstStableIdentityKey,
			stableIdentityGroupKey: priorFirstStableIdentityGroupKey,
			providerTransactionId: 'provider-transaction-sync-0-refreshed',
			description: 'A'.repeat(81),
			displayDescription: 'Updated Counterparty',
			counterpartyName: 'Updated Counterparty',
			bankTransactionDescription: 'Updated card payment',
			balanceAfterAmount: '111.95000000',
			referenceNumber: 'reference-sync-0-updated',
			categorySource: 'MANUAL',
			categoryStatus: 'COMPLETED',
		});
		expect(unchangedDuplicateEntryReferenceTransaction).toMatchObject({
			categorySource: 'AI',
			categoryStatus: 'COMPLETED',
		});
	});

	it('classifies Revolut currency exchange legs as internal non-category events and remains idempotent', async () => {
		const {connection} = await createAuthorizedConnectionFixture(
			'currency-exchange-session',
			[
				{
					providerAccountId: 'currency-exchange-eur-account',
					identificationHash: 'hash-currency-exchange-eur',
					currency: 'EUR',
				},
				{
					providerAccountId: 'currency-exchange-gbp-account',
					identificationHash: 'hash-currency-exchange-gbp',
					currency: 'GBP',
				},
			],
			'Revolut',
		);
		const sourceLeg: EnableBankingTransaction = {
			providerTransactionId: 'provider-currency-exchange-source',
			entryReference: 'entry-currency-exchange-source',
			amount: '10.00',
			currency: 'EUR',
			creditDebitIndicator: 'DBIT',
			status: 'BOOK',
			bookingDate: '2026-08-20',
			valueDate: '2026-08-20',
			description: 'Exchanged to GBP',
			counterpartyName: undefined,
			remittanceInformation: undefined,
		};
		const targetLeg: EnableBankingTransaction = {
			providerTransactionId: 'provider-currency-exchange-target',
			entryReference: 'entry-currency-exchange-target',
			amount: '8.50',
			currency: 'GBP',
			creditDebitIndicator: 'CRDT',
			status: 'BOOK',
			bookingDate: '2026-08-20',
			valueDate: '2026-08-20',
			description: 'Exchanged to GBP',
			counterpartyName: undefined,
			remittanceInformation: undefined,
		};
		const ordinaryPayment: EnableBankingTransaction = {
			providerTransactionId: 'provider-currency-exchange-card-payment',
			entryReference: 'entry-currency-exchange-card-payment',
			amount: '3.00',
			currency: 'EUR',
			creditDebitIndicator: 'DBIT',
			status: 'BOOK',
			bookingDate: '2026-08-19',
			valueDate: '2026-08-19',
			description: 'Card payment',
			bankTransactionCode: 'PMNT',
			bankTransactionSubCode: 'CARD',
			exchangeRate: '1.12',
			exchangeRateUnitCurrency: 'USD',
		};

		try {
			getAccountBalances.mockResolvedValue([]);
			getAccountTransactions
				.mockResolvedValueOnce([sourceLeg, ordinaryPayment])
				.mockResolvedValueOnce([targetLeg]);

			const firstResponse = await app.get(BankingSyncService).synchronizeAutomatically(connection.id);
			expect(firstResponse).toEqual(
				expect.objectContaining({
					status: 'SUCCEEDED',
					transactionsFetched: 3,
					transactionsAdded: 3,
				}),
			);

			const persisted = await bankTransactionRepository.find({
				where: [
					{providerTransactionId: sourceLeg.providerTransactionId},
					{providerTransactionId: targetLeg.providerTransactionId},
					{providerTransactionId: ordinaryPayment.providerTransactionId},
				],
			});
			const exchangeRows = persisted.filter(
				({providerTransactionId}) =>
					providerTransactionId === sourceLeg.providerTransactionId ||
					providerTransactionId === targetLeg.providerTransactionId,
			);
			expect(exchangeRows).toHaveLength(2);
			expect(exchangeRows).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						providerTransactionId: sourceLeg.providerTransactionId,
						amount: '-10.00000000',
						currency: 'EUR',
						creditDebitIndicator: 'DBIT',
						financialEventType: BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
						financialEventSource: BANK_TRANSACTION_FINANCIAL_EVENT_SOURCES.RULE,
						financialEventRuleVersion: BANK_TRANSACTION_FINANCIAL_EVENT_RULE_VERSION,
						category: null,
						categoryStatus: 'NOT_APPLICABLE',
						categoryInputHash: null,
					}),
					expect.objectContaining({
						providerTransactionId: targetLeg.providerTransactionId,
						amount: '8.50000000',
						currency: 'GBP',
						creditDebitIndicator: 'CRDT',
						financialEventType: 'CURRENCY_EXCHANGE',
						categoryStatus: 'NOT_APPLICABLE',
					}),
				]),
			);
			expect(
				persisted.find(
					({providerTransactionId}) => providerTransactionId === ordinaryPayment.providerTransactionId,
				),
			).toMatchObject({
				financialEventType: null,
				financialEventSource: null,
				categoryStatus: 'PENDING',
				categoryInputHash: expect.any(String),
				currencyExchangeCounterpartId: null,
			});

			// The only exchange of the day into GBP: its two legs are linked both ways.
			const storedSource = exchangeRows.find(({currency}) => currency === 'EUR')!;
			const storedTarget = exchangeRows.find(({currency}) => currency === 'GBP')!;
			expect(storedSource.currencyExchangeCounterpartId).toBe(storedTarget.id);
			expect(storedTarget.currencyExchangeCounterpartId).toBe(storedSource.id);
			const detailResponse = await verifiedAgent.get(`/bank-transactions/${storedSource.id}`).expect(200);
			expect(detailResponse.body.currencyExchangeCounterpart).toEqual({
				id: storedTarget.id,
				bankName: 'Revolut',
				bankAccountName: expect.any(String),
				bankAccountAlias: null,
				amount: '8.50000000',
				currency: 'GBP',
				bookingDate: '2026-08-20',
			});
			const listResponse = await verifiedAgent
				.get('/bank-transactions')
				.query({'filter[financialEventTypes][]': 'CURRENCY_EXCHANGE'})
				.expect(200);
			expect(listResponse.body.transactions).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						id: storedTarget.id,
						currencyExchangeCounterpart: expect.objectContaining({id: storedSource.id, currency: 'EUR'}),
					}),
				]),
			);

			getAccountBalances.mockResolvedValue([]);
			getAccountTransactions
				.mockResolvedValueOnce([sourceLeg, ordinaryPayment])
				.mockResolvedValueOnce([targetLeg]);
			const secondResponse = await synchronizeDue(connection.id);
			expect(secondResponse).toEqual(
				expect.objectContaining({
					status: 'SUCCEEDED',
					transactionsFetched: 3,
					transactionsAdded: 0,
				}),
			);
			expect(
				await bankTransactionRepository.count({
					where: [
						{providerTransactionId: sourceLeg.providerTransactionId},
						{providerTransactionId: targetLeg.providerTransactionId},
					],
				}),
			).toBe(2);
		} finally {
			await bankConnectionRepository.delete(connection.id);
		}
	});

	it('keeps stored transaction ids when a synchronization adds new transactions', async () => {
		const {connection} = await createAuthorizedConnectionFixture('stable-id-session', [
			{
				providerAccountId: 'stable-id-account',
				identificationHash: 'hash-stable-id-account',
				currency: 'EUR',
				name: 'Jane Example',
			},
		]);
		const storedPayment: EnableBankingTransaction = {
			providerTransactionId: 'stable-id-stored',
			entryReference: 'entry-stable-id-stored',
			amount: '12.50',
			currency: 'EUR',
			creditDebitIndicator: 'DBIT',
			status: 'BOOK',
			bookingDate: '2026-08-20',
			valueDate: '2026-08-20',
			description: 'Example Store',
		};
		const newPayment: EnableBankingTransaction = {
			...storedPayment,
			providerTransactionId: 'stable-id-new',
			entryReference: 'entry-stable-id-new',
			bookingDate: '2026-08-21',
			valueDate: '2026-08-21',
		};

		try {
			getAccountBalances.mockResolvedValue([]);
			getAccountTransactions.mockResolvedValueOnce([storedPayment]);
			await app.get(BankingSyncService).synchronizeAutomatically(connection.id);
			const {id, createdAt} = await bankTransactionRepository.findOneByOrFail({
				providerTransactionId: storedPayment.providerTransactionId,
			});

			// Providers list the newest booking first, so the new row precedes the stored one.
			getAccountTransactions.mockResolvedValueOnce([newPayment, storedPayment]);
			await expect(synchronizeDue(connection.id)).resolves.toMatchObject({
				status: 'SUCCEEDED',
				transactionsAdded: 1,
			});

			expect(
				await bankTransactionRepository.findOneByOrFail({
					providerTransactionId: storedPayment.providerTransactionId,
				}),
			).toMatchObject({id, createdAt});
		} finally {
			await bankConnectionRepository.delete(connection.id);
		}
	});

	it('links own-transfer legs after synchronization and unlinks them when a connection is removed', async () => {
		const revolutIban = 'GB82WEST12345698765432';
		const {connection: revolutConnection, bankAccounts: revolutAccounts} = await createAuthorizedConnectionFixture(
			'own-transfer-revolut-session',
			[
				{
					providerAccountId: 'own-transfer-revolut-eur',
					identificationHash: 'hash-own-transfer-revolut-eur',
					currency: 'EUR',
					iban: revolutIban,
					name: 'Jane Example',
				},
			],
			'Revolut',
		);
		const revolutLeg = await fixtures.createTransaction(revolutAccounts[0], {
			providerTransactionId: 'own-transfer-revolut-leg',
			amount: '250.00',
			creditDebitIndicator: 'CRDT',
			bookingDate: '2026-08-21',
			description: 'Payment from Jane Example',
		});
		const {connection: abnConnection} = await createAuthorizedConnectionFixture('own-transfer-abn-session', [
			{
				providerAccountId: 'own-transfer-abn-eur',
				identificationHash: 'hash-own-transfer-abn-eur',
				currency: 'EUR',
				name: 'Jane Example',
			},
		]);
		const abnLeg: EnableBankingTransaction = {
			providerTransactionId: 'own-transfer-abn-leg',
			entryReference: 'entry-own-transfer-abn-leg',
			amount: '250.00',
			currency: 'EUR',
			creditDebitIndicator: 'DBIT',
			status: 'BOOK',
			bookingDate: '2026-08-20',
			valueDate: '2026-08-20',
			description: 'Online banking transfer',
			counterpartyIban: revolutIban,
		};
		const unrelatedPayment: EnableBankingTransaction = {
			...abnLeg,
			providerTransactionId: 'own-transfer-abn-unrelated',
			entryReference: 'entry-own-transfer-abn-unrelated',
			counterpartyIban: 'NL91ABNA0417164300',
		};

		getAccountBalances.mockResolvedValue([]);
		getAccountTransactions.mockResolvedValueOnce([abnLeg, unrelatedPayment]);
		await expect(app.get(BankingSyncService).synchronizeAutomatically(abnConnection.id)).resolves.toMatchObject({
			status: 'SUCCEEDED',
			transactionsAdded: 2,
		});

		const storedAbnLeg = await bankTransactionRepository.findOneByOrFail({
			providerTransactionId: abnLeg.providerTransactionId,
		});
		expect(storedAbnLeg).toMatchObject({
			counterpartyIban: revolutIban,
			ownTransferEvidence: 'IBAN',
			ownTransferCounterpartId: revolutLeg.id,
		});
		expect(await bankTransactionRepository.findOneByOrFail({id: revolutLeg.id})).toMatchObject({
			ownTransferEvidence: 'IBAN',
			ownTransferCounterpartId: storedAbnLeg.id,
		});
		expect(
			await bankTransactionRepository.findOneByOrFail({
				providerTransactionId: unrelatedPayment.providerTransactionId,
			}),
		).toMatchObject({ownTransferEvidence: null, ownTransferCounterpartId: null});

		try {
			// A resync with identical provider data keeps the owner's decision and changes nothing else.
			await verifiedAgent
				.patch(`/bank-transactions/${storedAbnLeg.id}/own-transfer`)
				.send({override: 'UNMARKED'})
				.expect(200);
			getAccountTransactions.mockResolvedValueOnce([abnLeg, unrelatedPayment]);
			await expect(synchronizeDue(abnConnection.id)).resolves.toMatchObject({
				status: 'SUCCEEDED',
				transactionsAdded: 0,
			});
			expect(await bankTransactionRepository.findOneByOrFail({id: storedAbnLeg.id})).toMatchObject({
				ownTransferOverride: 'UNMARKED',
				ownTransferEvidence: null,
				ownTransferCounterpartId: null,
			});
			await verifiedAgent
				.patch(`/bank-transactions/${storedAbnLeg.id}/own-transfer`)
				.send({override: null})
				.expect(200);
			expect(await bankTransactionRepository.findOneByOrFail({id: storedAbnLeg.id})).toMatchObject({
				ownTransferEvidence: 'IBAN',
				ownTransferCounterpartId: revolutLeg.id,
			});

			await verifiedAgent
				.delete(`/bank-connections/${revolutConnection.id}`)
				.send({confirmation: 'DELETE'})
				.expect(204);

			expect(await bankTransactionRepository.findOneByOrFail({id: storedAbnLeg.id})).toMatchObject({
				ownTransferEvidence: null,
				ownTransferCounterpartId: null,
			});
		} finally {
			await bankConnectionRepository.delete([abnConnection.id, revolutConnection.id]);
		}
	});

	it('validates representative transaction limits', async () => {
		const {connection} = await createAuthorizedConnection('limit-validation');

		try {
			for (const [limit, expectedStatus] of [
				['1', 200],
				['100', 200],
				['10oops', 400],
				['0', 400],
				['101', 400],
			] as const) {
				await verifiedAgent
					.get(`/bank-connections/${connection.id}/transactions`)
					.query({limit})
					.expect(expectedStatus);
			}
		} finally {
			await bankConnectionRepository.delete(connection.id);
		}
	});

	it('uses the default transaction limit when omitted', async () => {
		const {connection, bankAccount} = await createAuthorizedConnection('default-limit-validation');

		try {
			await fixtures.createTransactions(
				bankAccount,
				Array.from({length: 26}, (_, index) => ({description: `Default limit transaction ${index}`})),
			);

			const response = await verifiedAgent.get(`/bank-connections/${connection.id}/transactions`).expect(200);

			expect(response.body.total).toBe(26);
			expect(response.body.transactions).toHaveLength(25);
		} finally {
			await bankConnectionRepository.delete(connection.id);
		}
	});

	it('marks expired consent before synchronization', async () => {
		const connection = await fixtures.createConnection(account, {
			providerSessionId: app.get(BankingEncryptionService).encrypt('expired-session'),
			consentValidUntil: new Date(Date.now() - 1),
		});

		try {
			getSessionAccounts.mockClear();
			getAccountBalances.mockClear();
			getAccountTransactions.mockClear();
			await expect(synchronizeDue(connection.id)).rejects.toMatchObject({
				status: 409,
			});

			expect(getSessionAccounts).not.toHaveBeenCalled();
			expect(getAccountBalances).not.toHaveBeenCalled();
			expect(getAccountTransactions).not.toHaveBeenCalled();
			const expiredConnection = await bankConnectionRepository.findOneBy({id: connection.id});
			expect(expiredConnection).toMatchObject({
				status: 'EXPIRED',
				lastSyncError: 'Bank consent has expired. Please reconnect.',
			});
			expect(await bankSyncRunRepository.count({where: {bankConnection: {id: connection.id}}})).toBe(0);
		} finally {
			await bankConnectionRepository.delete(connection.id);
		}
	});

	it('reconciles bank account activity from the provider account set', async () => {
		const {connection, bankAccounts} = await createAuthorizedConnectionFixture(
			'account-reconciliation-session',
			['account-keep', 'account-remove', 'account-reappear'].map((providerAccountId) => ({
				providerAccountId,
				identificationHash: `hash-${providerAccountId}`,
			})),
		);
		await bankAccountRepository.update({id: bankAccounts[2].id}, {isActive: false});
		sessionAccountIdsBySession.set('account-reconciliation-session', ['account-keep', 'account-reappear']);
		getAccountBalances.mockResolvedValue([]);
		getAccountTransactions.mockResolvedValue([]);

		try {
			const response = await app.get(BankingSyncService).synchronizeAutomatically(connection.id);

			expect(response).toMatchObject({status: 'SUCCEEDED'});
			expect(await bankAccountRepository.findOneBy({id: bankAccounts[0].id})).toMatchObject({
				isActive: true,
			});
			expect(await bankAccountRepository.findOneBy({id: bankAccounts[1].id})).toMatchObject({
				isActive: false,
			});
			expect(await bankAccountRepository.findOneBy({id: bankAccounts[2].id})).toMatchObject({
				isActive: true,
			});
		} finally {
			await bankConnectionRepository.delete(connection.id);
		}
	});

	it('preserves bank account activity when the provider account set is unavailable', async () => {
		const {connection, bankAccounts} = await createAuthorizedConnectionFixture(
			'account-reconciliation-failure-session',
			['account-still-active', 'account-still-inactive'].map((providerAccountId) => ({
				providerAccountId,
				identificationHash: `hash-${providerAccountId}`,
			})),
		);
		await bankAccountRepository.update({id: bankAccounts[1].id}, {isActive: false});
		getSessionAccounts.mockRejectedValueOnce(new EnableBankingClientError('provider_unreachable'));
		getAccountBalances.mockResolvedValue([]);
		getAccountTransactions.mockResolvedValue([]);

		try {
			const response = await app.get(BankingSyncService).synchronizeAutomatically(connection.id);

			expect(response).toMatchObject({
				status: 'PARTIAL',
				errorMessage: 'Some bank data could not be synchronized.',
			});
			expect(await bankAccountRepository.findOneBy({id: bankAccounts[0].id})).toMatchObject({
				isActive: true,
			});
			expect(await bankAccountRepository.findOneBy({id: bankAccounts[1].id})).toMatchObject({
				isActive: false,
			});
		} finally {
			await bankConnectionRepository.delete(connection.id);
		}
	});

	it('returns provider rate-limit retry metadata for a partial sync', async () => {
		const {connection} = await createAuthorizedConnection('rate-limit-session');
		getAccountBalances.mockRejectedValueOnce(new EnableBankingClientError('ASPSP_RATE_LIMIT_EXCEEDED', 429, 17));
		getAccountTransactions.mockResolvedValue([]);

		try {
			const response = await app.get(BankingSyncService).synchronizeAutomatically(connection.id);

			expect(response).toMatchObject({
				status: 'PARTIAL',
				rateLimitSource: 'enable-banking',
				retryAfterSeconds: 17,
			});
		} finally {
			await bankConnectionRepository.delete(connection.id);
		}
	});

	it('marks a run partial when one account fails and preserves successful account data', async () => {
		const connection = await createAuthorizedConnectionWithAccounts('partial-session', [
			'partial-success-account',
			'partial-failed-account',
		]);
		getAccountBalances.mockImplementation(async (accountId) => {
			if (accountId === 'partial-failed-account') {
				throw new EnableBankingClientError('provider_unreachable');
			}
			return makeBalances();
		});
		getAccountTransactions.mockImplementation(async (accountId) => {
			if (accountId === 'partial-failed-account') {
				throw new EnableBankingClientError('provider_unreachable');
			}
			return makeTransactions('partial');
		});

		const response = await app.get(BankingSyncService).synchronizeAutomatically(connection.id);
		expect(response).toMatchObject({
			status: 'PARTIAL',
			errorMessage: 'Some bank data could not be synchronized.',
		});
		const successfulBankAccount = await bankAccountRepository.findOne({
			where: {bankConnection: {id: connection.id}, providerAccountId: 'partial-success-account'},
		});
		if (!successfulBankAccount) throw new Error('Expected successful bank account.');
		expect(await bankTransactionRepository.count({where: {bankAccountId: successfulBankAccount.id}})).toBe(5);
		expect(JSON.stringify(response)).not.toContain('provider_unreachable');
	});

	it('rolls back balance and transaction persistence when a transaction cannot be stored', async () => {
		const {connection, bankAccount} = await createAuthorizedConnection('rollback-sync-session');
		getAccountBalances.mockResolvedValueOnce(makeBalances());
		getAccountTransactions.mockResolvedValueOnce([
			{
				...makeTransactions('rollback')[0],
				amount: 'not-a-number',
			},
		]);

		await expect(app.get(BankingSyncService).synchronizeAutomatically(connection.id)).rejects.toMatchObject({
			status: 500,
			message: 'Bank synchronization could not be saved.',
		});
		expect(await bankAccountBalanceRepository.count({where: {bankAccountId: bankAccount.id}})).toBe(0);
		expect(await bankTransactionRepository.count({where: {bankAccountId: bankAccount.id}})).toBe(0);
		expect(await bankSyncRunRepository.count({where: {bankConnection: {id: connection.id}}})).toBe(1);
		expect(await bankSyncRunRepository.findOne({where: {bankConnection: {id: connection.id}}})).toMatchObject({
			status: 'FAILED',
			errorMessage: 'Bank synchronization could not be saved.',
		});
	});

	type BankAccountFixture = {
		providerAccountId: string;
		identificationHash: string;
		details?: string;
		currency?: string;
		iban?: string;
		name?: string;
	};

	/** Starts an ABN AMRO authorization and returns the state the provider would echo back to the callback. */
	async function authorize(): Promise<string> {
		await verifiedAgent
			.post('/bank-connections/authorize')
			.send({aspspName: 'ABN AMRO', aspspCountry: 'NL'})
			.expect(201);
		const state = startAuthorization.mock.calls.at(-1)?.[0].state;
		if (!state) throw new Error('Authorization state was not created.');
		return state;
	}

	function callback(query: Record<string, string | undefined>, result: 'connected' | 'cancelled' | 'error') {
		return request(httpServer)
			.get('/bank-connections/callback')
			.query(query)
			.expect(302)
			.expect('Location', `http://localhost:5173/bank-connections?result=${result}`);
	}

	function createIncompleteConnection(status: string) {
		return fixtures.createConnection(account, {status, consentValidUntil: null});
	}

	/** Runs a queued automatic sync of the connection that returns these transactions. */
	async function synchronizeQueued(connectionId: string, transactions: EnableBankingTransaction[]) {
		getAccountBalances.mockResolvedValueOnce(makeBalances());
		getAccountTransactions.mockResolvedValueOnce(transactions);
		return synchronizeDue(connectionId);
	}

	/** Makes the connection due and runs its automatic sync with the provider mocks already in place. */
	async function synchronizeDue(connectionId: string) {
		await bankConnectionRepository.update(connectionId, {
			nextSyncAt: new Date(Date.now() - 1),
			syncStatus: 'QUEUED',
		});
		return app.get(BankingSyncService).synchronizeAutomatically(connectionId);
	}

	async function createAuthorizedConnection(providerSessionId: string) {
		const {connection, bankAccounts} = await createAuthorizedConnectionFixture(providerSessionId, [
			{
				providerAccountId: 'sync-provider-account',
				identificationHash: `hash-${providerSessionId}`,
				details: 'Test account',
			},
		]);
		return {connection, bankAccount: bankAccounts[0]};
	}

	async function createAuthorizedConnectionWithAccounts(providerSessionId: string, providerAccountIds: string[]) {
		const {connection} = await createAuthorizedConnectionFixture(
			providerSessionId,
			providerAccountIds.map((providerAccountId) => ({
				providerAccountId,
				identificationHash: `hash-${providerAccountId}`,
			})),
		);
		return connection;
	}

	async function createAuthorizedConnectionFixture(
		providerSessionId: string,
		bankAccountFixtures: BankAccountFixture[],
		aspspName = 'ABN AMRO',
	) {
		const connection = await fixtures.createConnection(account, {
			aspspName,
			providerSessionId: app.get(BankingEncryptionService).encrypt(providerSessionId),
			consentValidUntil: new Date(Date.now() + 60 * 60 * 1000),
			nextSyncAt: new Date(Date.now() - 60 * 1000),
		});
		const bankAccounts = await fixtures.createBankAccounts(
			connection,
			bankAccountFixtures.map((bankAccount) => ({name: 'Sync account', ...bankAccount})),
		);
		sessionAccountIdsBySession.set(
			providerSessionId,
			bankAccounts.map((bankAccount) => bankAccount.providerAccountId),
		);
		return {connection, bankAccounts};
	}
});

function makeBalances(): EnableBankingBalance[] {
	return [
		{
			name: 'Available balance',
			balanceType: 'AVAILABLE',
			amount: '123.45',
			currency: 'EUR',
			lastChangeDateTime: '2026-08-26T12:00:00.000Z',
			referenceDate: '2026-08-26',
			lastCommittedTransaction: 'provider-entry-sync-last',
		},
		{
			name: 'Booked balance',
			balanceType: 'BOOKED',
			amount: '120.00',
			currency: 'EUR',
			referenceDate: '2026-08-26',
		},
	];
}

function makeTransactions(prefix: string): EnableBankingTransaction[] {
	return Array.from({length: 5}, (_, index) => ({
		providerTransactionId: `provider-transaction-${prefix}-${index}`,
		entryReference: `provider-entry-${prefix}-${index}`,
		merchantCategoryCode: '5411',
		amount: index === 0 ? '12.50' : '4.00',
		currency: 'EUR',
		creditDebitIndicator: index === 0 ? 'DBIT' : 'CRDT',
		status: 'BOOK',
		bookingDate: `2026-08-${String(26 - index).padStart(2, '0')}`,
		valueDate: `2026-08-${String(26 - index).padStart(2, '0')}`,
		description: `Provider description ${index}`,
		counterpartyName: `Counterparty ${index}`,
		remittanceInformation: `Payment ${index}`,
		transactionDate: index === 0 ? '2026-08-24' : `2026-08-${String(26 - index).padStart(2, '0')}`,
		bankTransactionCode: index === 0 ? 'PMNT' : undefined,
		bankTransactionSubCode: index === 0 ? 'CARD' : undefined,
		bankTransactionDescription: index === 0 ? 'Card payment' : undefined,
		balanceAfterAmount: index === 0 ? '110.95' : undefined,
		balanceAfterCurrency: index === 0 ? 'EUR' : undefined,
		instructedAmount: index === 0 ? '12.00' : undefined,
		instructedCurrency: index === 0 ? 'USD' : undefined,
		exchangeRate: index === 0 ? '0.9234' : undefined,
		exchangeRateUnitCurrency: index === 0 ? 'USD' : undefined,
		exchangeRateType: index === 0 ? 'SPOT' : undefined,
		referenceNumber: index === 0 ? 'reference-sync-0' : undefined,
		referenceNumberScheme: index === 0 ? 'RF' : undefined,
	}));
}
