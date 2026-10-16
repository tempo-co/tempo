import {jest} from '@jest/globals';
import {getQueueToken} from '@nestjs/bullmq';
import {INestApplication} from '@nestjs/common';
import {getRepositoryToken} from '@nestjs/typeorm';
import argon2 from 'argon2';
import {Queue} from 'bullmq';
import {Server} from 'node:net';
import request from 'supertest';
import TestAgent from 'supertest/lib/agent';
import {DataSource, DeepPartial, Repository} from 'typeorm';

import {ConfigurationService} from '@core/config/config.service';
import {EmailService} from '@core/email/email.service';
import {EMAIL_QUEUE} from '@core/queue/queue.constants';
import {Account} from '@modules/account/account.entity';
import {BankConnectionAlertService} from '@modules/banking/alerts/bank-connection-alert.service';
import {BankConnection} from '@modules/banking/bank-connection.entity';
import {BankingEncryptionService} from '@modules/banking/services/banking-encryption.service';
import {BankingSyncService} from '@modules/banking/services/banking-sync.service';
import {EnableBankingClient, EnableBankingClientError} from '@modules/banking/services/enable-banking.client';

import {BankingFixtures} from '../../../scripts/seed-data/banking-fixtures';
import {getApp, loginAgent} from '../../setup/e2e.setup';
import {MailpitMessageSummaryResponse, MailpitResponse} from '../../types/mailpit';
import {EmailUtils} from '../../utils/email-utils';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const OWNER_EMAIL = 'alert-owner@example.test';
const OWNER_PASSWORD = 'alert-owner-password';
const OTHER_EMAIL = 'alert-other@example.test';
const UNVERIFIED_EMAIL = 'alert-unverified@example.test';
const BANK_NAME = 'Example Bank';
const SYNTHETIC_IBAN = 'NL91ABNA0417164300';

describe('Bank connection email alerts', () => {
	let app: INestApplication;
	let httpServer: Server;
	let fixtures: BankingFixtures;
	let connections: Repository<BankConnection>;
	let accounts: Repository<Account>;
	let alerts: BankConnectionAlertService;
	let emailQueue: Queue;
	let mailpitUrl: string;
	let webBaseUrl: string;
	let owner: Account;
	let other: Account;
	let unverified: Account;
	let ownerAgent: TestAgent;
	let enableBankingClient: EnableBankingClient;

	beforeAll(async () => {
		app = getApp();
		httpServer = app.getHttpServer();
		fixtures = new BankingFixtures(app);
		connections = fixtures.connections;
		accounts = app.get(getRepositoryToken(Account));
		alerts = app.get(BankConnectionAlertService);
		emailQueue = app.get(getQueueToken(EMAIL_QUEUE));
		const config = app.get(ConfigurationService);
		mailpitUrl = config.get('EMAIL_UI_URL');
		webBaseUrl = config.get('WEB_BASE_URL');

		owner = await createAccount('Alert Owner', OWNER_EMAIL, true, OWNER_PASSWORD);
		other = await createAccount('Alert Other', OTHER_EMAIL, true);
		unverified = await createAccount('Alert Unverified', UNVERIFIED_EMAIL, false);
		ownerAgent = await loginAgent(httpServer, OWNER_EMAIL, OWNER_PASSWORD);

		enableBankingClient = app.get(EnableBankingClient);
		jest.spyOn(enableBankingClient, 'getSessionAccounts').mockImplementation(async () => ({
			status: 'AUTHORIZED',
			accountIds: ['alert-provider-account'],
		}));
		jest.spyOn(enableBankingClient, 'getAccountBalances').mockResolvedValue([]);
		jest.spyOn(enableBankingClient, 'getAccountTransactions').mockResolvedValue([]);
		jest.spyOn(enableBankingClient, 'getAspsps').mockResolvedValue([
			{name: 'Example Bank', country: 'NL', maximumConsentValiditySeconds: (90 * DAY) / 1000},
		]);
	});

	beforeEach(async () => {
		await connections
			.createQueryBuilder()
			.delete()
			.where('accountId IN (:...ids)', {ids: [owner.id, other.id, unverified.id]})
			.execute();
		await clearMailbox();
	});

	afterAll(async () => {
		await accounts.delete([owner.id, other.id, unverified.id]);
		jest.restoreAllMocks();
	});

	it('sends no email for a healthy connection', async () => {
		await createConnection(owner);

		await scanAndDeliver();

		expect(await messagesTo(OWNER_EMAIL)).toHaveLength(0);
	});

	it('warns once a week before consent ends, then once more on the last day', async () => {
		const consentValidUntil = new Date(Date.now() + 3 * DAY);
		const connection = await createConnection(owner, {consentValidUntil});

		await scanAndDeliver();
		await scanAndDeliver();

		const [weekWarning] = await expectMessages(OWNER_EMAIL, 1);
		expect(weekWarning.Subject).toBe(`Your ${BANK_NAME} connection to Tempo ends soon`);
		expect(weekWarning.Text).toContain(BANK_NAME);
		expect(weekWarning.HTML).toContain(`href="${webBaseUrl}/bank-connections"`);

		// The consent date moves into the last day without reauthorization.
		await clearMailbox();
		await connections.update(connection.id, {consentValidUntil: new Date(Date.now() + 20 * HOUR)});
		// Keep the 7-day marker on the new date: the earlier warning covered this consent.
		await connections.update(connection.id, {consentExpiringAlertFor: () => '"consentValidUntil"'});

		await scanAndDeliver();
		await scanAndDeliver();

		const [lastDay] = await expectMessages(OWNER_EMAIL, 1);
		expect(lastDay.Subject).toBe(`Last day to reconnect ${BANK_NAME} in Tempo`);
	});

	it('sends a single last-day warning when the 7-day window was missed', async () => {
		await createConnection(owner, {consentValidUntil: new Date(Date.now() + 20 * HOUR)});

		await scanAndDeliver();
		await scanAndDeliver();

		const [message] = await expectMessages(OWNER_EMAIL, 1);
		expect(message.Subject).toBe(`Last day to reconnect ${BANK_NAME} in Tempo`);
	});

	it('warns again about a reauthorized consent once its new end date is near', async () => {
		const connection = await createConnection(owner, {
			aspspName: 'Example Bank',
			consentValidUntil: new Date(Date.now() + 3 * DAY),
		});
		await scanAndDeliver();
		await expectMessages(OWNER_EMAIL, 1);

		const newConsentValidUntil = new Date(Date.now() + 5 * DAY);
		await reauthorize(newConsentValidUntil);
		const reauthorized = await connections.findOneByOrFail({id: connection.id});
		expect(reauthorized.consentValidUntil?.getTime()).toBe(newConsentValidUntil.getTime());
		expect(await connections.countBy({accountId: owner.id})).toBe(1);

		await clearMailbox();
		await scanAndDeliver();
		await scanAndDeliver();

		const [message] = await expectMessages(OWNER_EMAIL, 1);
		expect(message.Subject).toBe('Your Example Bank connection to Tempo ends soon');
	});

	it.each([
		['failed', {syncStatus: 'FAILED', lastSyncError: 'Synchronization failed.'}],
		['rate limited', {syncStatus: 'RATE_LIMITED'}],
		['stuck', {syncStatus: 'RUNNING', syncStartedAt: new Date(Date.now() - 2 * DAY)}],
	])('alerts once when a %s connection has not synced for a day', async (_name, overrides) => {
		await createConnection(owner, {lastSyncedAt: new Date(Date.now() - 25 * HOUR), ...overrides});

		await scanAndDeliver();
		await scanAndDeliver();

		const [message] = await expectMessages(OWNER_EMAIL, 1);
		expect(message.Subject).toBe(`Tempo can't sync ${BANK_NAME}`);
	});

	it('does not alert about a rate-limited connection that synced within the day', async () => {
		await createConnection(owner, {syncStatus: 'RATE_LIMITED', lastSyncedAt: new Date(Date.now() - 20 * HOUR)});

		await scanAndDeliver();

		expect(await messagesTo(OWNER_EMAIL)).toHaveLength(0);
	});

	it('alerts about an expired consent that has stopped syncing', async () => {
		await createConnection(owner, {
			status: 'EXPIRED',
			syncStatus: 'EXPIRED',
			consentValidUntil: new Date(Date.now() - 2 * DAY),
			lastSyncedAt: new Date(Date.now() - 2 * DAY),
		});

		await scanAndDeliver();
		await scanAndDeliver();

		const [message] = await expectMessages(OWNER_EMAIL, 1);
		expect(message.Subject).toBe(`Tempo can't sync ${BANK_NAME}`);
		expect(message.Text).toContain(`The access you gave Tempo to ${BANK_NAME} has ended.`);
	});

	it('gives a never-synced connection a day from creation before alerting', async () => {
		const connection = await createConnection(owner, {lastSyncedAt: null, syncStatus: 'FAILED'});

		await scanAndDeliver();
		expect(await messagesTo(OWNER_EMAIL)).toHaveLength(0);

		await connections.update(connection.id, {createdAt: new Date(Date.now() - 25 * HOUR)});
		await scanAndDeliver();

		const [message] = await expectMessages(OWNER_EMAIL, 1);
		expect(message.Text).toContain('It has not synced successfully since you connected it.');
	});

	it('alerts about a new broken-sync episode only after a successful sync', async () => {
		const connection = await createConnection(owner, {
			providerSessionId: app.get(BankingEncryptionService).encrypt('alert-provider-session'),
			lastSyncedAt: new Date(Date.now() - 25 * HOUR),
			syncStatus: 'FAILED',
		});
		await fixtures.createBankAccount(connection, {providerAccountId: 'alert-provider-account'});
		await scanAndDeliver();
		await expectMessages(OWNER_EMAIL, 1);

		await connections.update(connection.id, {nextSyncAt: new Date(Date.now() - 1), syncStatus: 'QUEUED'});
		await expect(app.get(BankingSyncService).synchronizeAutomatically(connection.id)).resolves.toMatchObject({
			status: 'SUCCEEDED',
		});

		// Sync breaks again: the next episode starts a day after that success.
		await clearMailbox();
		await scanAndDeliver(new Date(Date.now() + 23 * HOUR));
		expect(await messagesTo(OWNER_EMAIL)).toHaveLength(0);

		await scanAndDeliver(new Date(Date.now() + 25 * HOUR));
		await scanAndDeliver(new Date(Date.now() + 26 * HOUR));
		await expectMessages(OWNER_EMAIL, 1);
	});

	it('resets the sync alert when a success captured before the scan commits afterwards', async () => {
		const connection = await createConnection(owner, {
			lastSyncedAt: new Date(Date.now() - 25 * HOUR),
			syncStatus: 'FAILED',
		});
		const finishedAt = new Date();
		await scanAndDeliver(new Date(finishedAt.getTime() + 60_000));
		await expectMessages(OWNER_EMAIL, 1);

		// The sync finished before the scan but only persisted its result after the alert transaction.
		await fixtures.createSyncRun(connection, {finishedAt});
		await connections.update(connection.id, {lastSyncedAt: finishedAt, syncStatus: 'SUCCEEDED'});
		await clearMailbox();
		await scanAndDeliver(new Date(finishedAt.getTime() + 25 * HOUR));
		await scanAndDeliver(new Date(finishedAt.getTime() + 26 * HOUR));
		await expectMessages(OWNER_EMAIL, 1);
	});

	it('alerts after a day without a successful sync even when partial rate-limited runs refresh lastSyncedAt', async () => {
		const connection = await createConnection(owner, {
			providerSessionId: app.get(BankingEncryptionService).encrypt('alert-provider-session'),
			lastSyncedAt: new Date(Date.now() - 25 * HOUR),
		});
		await fixtures.createBankAccount(connection, {providerAccountId: 'alert-provider-account'});
		for (let attempt = 0; attempt < 2; attempt++) {
			await connections.update(connection.id, {nextSyncAt: new Date(Date.now() - 1), syncStatus: 'QUEUED'});
			jest.spyOn(enableBankingClient, 'getAccountBalances').mockRejectedValueOnce(
				new EnableBankingClientError('ASPSP_RATE_LIMIT_EXCEEDED', 429, 17),
			);
			await expect(app.get(BankingSyncService).synchronizeAutomatically(connection.id)).resolves.toMatchObject({
				status: 'PARTIAL',
			});
		}
		expect((await connections.findOneByOrFail({id: connection.id})).lastSyncedAt?.getTime()).toBeGreaterThan(
			Date.now() - HOUR,
		);

		await scanAndDeliver();
		await scanAndDeliver();
		const [message] = await expectMessages(OWNER_EMAIL, 1);
		expect(message.Subject).toBe(`Tempo can't sync ${BANK_NAME}`);
	});

	it('retries only the alert whose email could not be queued', async () => {
		await createConnection(owner, {
			consentValidUntil: new Date(Date.now() + 3 * DAY),
			lastSyncedAt: new Date(Date.now() - 2 * DAY),
			syncStatus: 'FAILED',
		});
		const emailService = app.get(EmailService);
		const send = emailService.send.bind(emailService);
		jest.spyOn(emailService, 'send')
			.mockImplementationOnce(send)
			.mockRejectedValueOnce(new Error('Email queue unavailable.'));

		await scanAndDeliver();
		await scanAndDeliver();

		const messages = await expectMessages(OWNER_EMAIL, 2);
		expect(messages.map((message) => message.Subject).sort()).toEqual([
			`Tempo can't sync ${BANK_NAME}`,
			`Your ${BANK_NAME} connection to Tempo ends soon`,
		]);
	});

	it('does not duplicate an email when the database commit fails after enqueue', async () => {
		const connection = await createConnection(owner, {consentValidUntil: new Date(Date.now() + 3 * DAY)});
		const dataSource = app.get(DataSource);
		const createRunner = dataSource.createQueryRunner.bind(dataSource);
		const runner = createRunner();
		jest.spyOn(runner, 'commitTransaction').mockRejectedValueOnce(new Error('Commit failed.'));
		const createQueryRunner = jest.spyOn(dataSource, 'createQueryRunner');
		// The scan's candidate query runs first; fail the following transaction's commit.
		createQueryRunner.mockImplementationOnce(createRunner).mockReturnValueOnce(runner);
		try {
			await scanAndDeliver();
			expect((await connections.findOneByOrFail({id: connection.id})).consentExpiringAlertFor).toBeNull();
			await scanAndDeliver();
			expect((await connections.findOneByOrFail({id: connection.id})).consentExpiringAlertFor).toEqual(
				connection.consentValidUntil,
			);
			await expectMessages(OWNER_EMAIL, 1);
		} finally {
			createQueryRunner.mockRestore();
		}
	});

	it('does not duplicate alerts across overlapping scans', async () => {
		await createConnection(owner, {
			consentValidUntil: new Date(Date.now() + 3 * DAY),
			lastSyncedAt: new Date(Date.now() - 2 * DAY),
			syncStatus: 'FAILED',
		});

		await Promise.all([alerts.scan(), alerts.scan(), alerts.scan()]);
		await scanAndDeliver();
		await expectMessages(OWNER_EMAIL, 2);
	});

	it("emails each connection's own verified owner only", async () => {
		const brokenSync = {lastSyncedAt: new Date(Date.now() - 2 * DAY), syncStatus: 'FAILED'};
		await createConnection(other, brokenSync);
		await createConnection(unverified, brokenSync);
		await createConnection(owner, {status: 'CANCELLED', ...brokenSync});
		await createConnection(owner, {status: 'PENDING_AUTHORIZATION', consentValidUntil: null, ...brokenSync});

		await scanAndDeliver();

		expect(await messagesTo(OWNER_EMAIL)).toHaveLength(0);
		expect(await messagesTo(UNVERIFIED_EMAIL)).toHaveLength(0);
		const [message] = await expectMessages(OTHER_EMAIL, 1);
		expect(message.To.map((recipient) => recipient.Address)).toEqual([OTHER_EMAIL]);
	});

	it('keeps account and transaction data out of the email', async () => {
		const connection = await createConnection(owner, {
			consentValidUntil: new Date(Date.now() + 3 * DAY),
			lastSyncedAt: new Date(Date.now() - 2 * DAY),
			syncStatus: 'FAILED',
		});
		const bankAccount = await fixtures.createBankAccount(connection, {
			name: 'Synthetic Savings',
			iban: SYNTHETIC_IBAN,
			currentBalanceAmount: '4321.09',
		});
		await fixtures.createTransaction(bankAccount, {
			amount: '-987.65',
			counterpartyName: 'Example Shop',
			remittanceInformation: 'Synthetic reference 4242',
		});

		await scanAndDeliver();

		const messages = await expectMessages(OWNER_EMAIL, 2);
		for (const message of messages) {
			const content = `${message.Subject}\n${message.Text}\n${message.HTML}`;
			for (const privateValue of [
				SYNTHETIC_IBAN,
				'Synthetic Savings',
				'4321',
				'987',
				'Example Shop',
				'Synthetic reference',
				connection.id,
				bankAccount.id,
			]) {
				expect(content).not.toContain(privateValue);
			}
		}
	});

	async function createAccount(name: string, email: string, isEmailVerified: boolean, password = 'unused') {
		return accounts.save(accounts.create({name, email, isEmailVerified, password: await argon2.hash(password)}));
	}

	async function createConnection(account: Account, overrides: DeepPartial<BankConnection> = {}) {
		const connection = await fixtures.createConnection(account, {
			aspspName: BANK_NAME,
			consentValidUntil: new Date(Date.now() + 90 * DAY),
			lastSyncedAt: new Date(Date.now() - HOUR),
			syncStatus: 'SUCCEEDED',
			...overrides,
		});
		if (connection.lastSyncedAt) {
			await fixtures.createSyncRun(connection, {finishedAt: connection.lastSyncedAt});
		}
		return connection;
	}

	/** Runs the real Example Bank reauthorization callback, which merges into the owner's existing connection. */
	async function reauthorize(consentValidUntil: Date) {
		jest.spyOn(enableBankingClient, 'startAuthorization').mockResolvedValueOnce({
			url: 'https://auth.example.test/authorize',
			authorizationId: 'alert-authorization',
		});
		jest.spyOn(enableBankingClient, 'createSession').mockResolvedValueOnce({
			sessionId: 'alert-provider-session-renewed',
			consentValidUntil: consentValidUntil.toISOString(),
			aspsp: {name: 'Example Bank', country: 'NL'},
			accounts: [{uid: 'alert-provider-account', identificationHash: 'alert-identification', currency: 'EUR'}],
		});
		await ownerAgent
			.post('/bank-connections/authorize')
			.send({aspspName: 'Example Bank', aspspCountry: 'NL'})
			.expect(201);
		const startAuthorization = jest.mocked(enableBankingClient.startAuthorization);
		const state = startAuthorization.mock.calls.at(-1)?.[0].state;
		if (!state) throw new Error('Authorization state was not created.');
		await request(httpServer)
			.get('/bank-connections/callback')
			.query({state, code: 'alert-reauthorization-code'})
			.expect(302)
			.expect('Location', `${webBaseUrl}/bank-connections?result=connected`);
	}

	/** Runs one scan and waits until the email worker has handed every queued email to Mailpit. */
	async function scanAndDeliver(now = new Date()) {
		await alerts.scan(now);
		for (let attempt = 0; attempt < 50; attempt++) {
			const counts = await emailQueue.getJobCounts('waiting', 'active', 'delayed', 'prioritized');
			if (Object.values(counts).every((count) => count === 0)) return;
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		throw new Error('Queued emails were not delivered.');
	}

	async function clearMailbox() {
		await EmailUtils.clearEmails(mailpitUrl);
	}

	async function messagesTo(recipient: string): Promise<MailpitMessageSummaryResponse[]> {
		const response = await fetch(`${mailpitUrl}/api/v1/messages?limit=200`);
		const {messages} = (await response.json()) as MailpitResponse;
		const matching = messages.filter((message) => message.To.some((to) => to.Address === recipient));
		return Promise.all(
			matching.map(async (message) => {
				const full = await fetch(`${mailpitUrl}/api/v1/message/${message.ID}`);
				return (await full.json()) as MailpitMessageSummaryResponse;
			}),
		);
	}

	async function expectMessages(recipient: string, count: number) {
		const messages = await messagesTo(recipient);
		expect(messages).toHaveLength(count);
		return messages;
	}
});
