import {jest} from '@jest/globals';
import {getQueueToken} from '@nestjs/bullmq';
import {INestApplication} from '@nestjs/common';
import {getRepositoryToken} from '@nestjs/typeorm';
import {Queue} from 'bullmq';
import {Server} from 'node:net';
import TestAgent from 'supertest/lib/agent';
import {DeepPartial, Repository} from 'typeorm';
import {WebPushError} from 'web-push';

import {ConfigurationService} from '@core/config/config.service';
import {DELIVER_PUSH_ALERT_JOB, PUSH_NOTIFICATION_QUEUE} from '@core/queue/queue.constants';
import {Account} from '@modules/account/account.entity';
import {BankConnectionAlertService} from '@modules/banking/alerts/bank-connection-alert.service';
import {RecurringBillAlertService} from '@modules/banking/alerts/recurring-bill-alert.service';
import {BankConnection} from '@modules/banking/bank-connection.entity';
import {alertDate, pushAlertDeliveryTime} from '@modules/notifications/push-alert-hours';
import {PushNotificationService} from '@modules/notifications/push-notification.service';
import {PushSubscription} from '@modules/notifications/push-subscription.entity';
import {WebPushSender} from '@modules/notifications/web-push.sender';

import {BankingFixtures, bookedRow} from '../../../scripts/seed-data/banking-fixtures';
import {enableWebPushE2e, getApp, loginAgent} from '../../setup/e2e.setup';
import {createVerifiedAccount} from '../../utils/auth-utils';

enableWebPushE2e();

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const ORIGIN = 'http://localhost:5173';
const BANK_NAME = 'Example Bank';
const P256DH = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM';
const AUTH = 'tBHItJI5svbpez7KI4CCXg';

function endpoint(name: string) {
	return `https://fcm.googleapis.com/fcm/send/example-${name}`;
}

function registration(name: string) {
	return {endpoint: endpoint(name), keys: {p256dh: P256DH, auth: AUTH}};
}

/** `days` days before `date` (`YYYY-MM-DD`). */
function daysBefore(date: string, days: number): string {
	return new Date(Date.parse(`${date}T00:00:00Z`) - days * DAY).toISOString().slice(0, 10);
}

/** The 5th of the month `months` months before `date`'s month. */
function fifthMonthsBefore(date: string, months: number): string {
	const [year, month] = date.split('-').map(Number);
	return new Date(Date.UTC(year, month - 1 - months, 5)).toISOString().slice(0, 10);
}

describe('Push notifications', () => {
	jest.setTimeout(30_000);

	let app: INestApplication;
	let httpServer: Server;
	let fixtures: BankingFixtures;
	let accounts: Repository<Account>;
	let subscriptions: Repository<PushSubscription>;
	let pushQueue: Queue;
	let bankAlerts: BankConnectionAlertService;
	let billAlerts: RecurringBillAlertService;
	let send: jest.SpiedFunction<WebPushSender['send']>;
	let mailpitUrl: string;
	let webBaseUrl: string;

	beforeAll(async () => {
		app = getApp();
		httpServer = app.getHttpServer();
		fixtures = new BankingFixtures(app);
		accounts = app.get(getRepositoryToken(Account));
		subscriptions = app.get(getRepositoryToken(PushSubscription));
		pushQueue = app.get(getQueueToken(PUSH_NOTIFICATION_QUEUE));
		bankAlerts = app.get(BankConnectionAlertService);
		billAlerts = app.get(RecurringBillAlertService);
		const config = app.get(ConfigurationService);
		mailpitUrl = config.get('EMAIL_UI_URL');
		webBaseUrl = config.get('WEB_BASE_URL');
		send = jest.spyOn(app.get(WebPushSender), 'send').mockResolvedValue(undefined);
	});

	beforeEach(() => send.mockClear());

	afterAll(() => {
		jest.restoreAllMocks();
	});

	/** A new verified owner, signed in, with this browser subscribed. */
	async function subscribedOwner(name: string) {
		const owner = await createVerifiedAccount(httpServer, mailpitUrl);
		await subscribe(owner.agent, name);
		return owner;
	}

	function subscribe(agent: TestAgent, name: string) {
		return agent.put('/notifications/subscriptions').set('Origin', ORIGIN).send(registration(name)).expect(204);
	}

	/** Every push the stubbed sender was asked to send: the endpoint and the decoded payload. */
	function sentPushes() {
		return send.mock.calls.map(([subscription, payload]) => ({
			endpoint: subscription.endpoint,
			payload: JSON.parse(payload) as Record<string, unknown>,
		}));
	}

	/** Waits until the push worker has handled every job that is due now. */
	async function deliverDuePushes() {
		for (let attempt = 0; attempt < 50; attempt++) {
			const counts = await pushQueue.getJobCounts('waiting', 'active', 'prioritized');
			if (Object.values(counts).every((count) => count === 0)) return;
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		throw new Error('Queued pushes were not delivered.');
	}

	/** A time during the day, at or just after now, so alerts are not held until morning. */
	const daytime = () => pushAlertDeliveryTime(new Date());

	/** A connection whose last successful sync was 25 hours ago, unless overridden. */
	async function createBrokenConnection(accountId: string, overrides: DeepPartial<BankConnection> = {}) {
		const connection = await fixtures.createConnection(
			{id: accountId},
			{
				aspspName: BANK_NAME,
				consentValidUntil: new Date(Date.now() + 90 * DAY),
				lastSyncedAt: new Date(Date.now() - 25 * HOUR),
				syncStatus: 'FAILED',
				...overrides,
			},
		);
		await fixtures.createSyncRun(connection, {finishedAt: connection.lastSyncedAt!});
		return connection;
	}

	/** The next 22:00 UTC after now: 23:00 or midnight in Amsterdam, within a day, while a 25-hour-old sync is broken. */
	function nextNight(): Date {
		const now = new Date();
		const night = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 22);
		return new Date(night > now.getTime() ? night : night + DAY);
	}

	describe('subscriptions and preferences', () => {
		it('registers this browser, saves alert choices and removes the subscription again', async () => {
			const owner = await createVerifiedAccount(httpServer, mailpitUrl);

			const {body: initial} = await owner.agent.get('/notifications').expect(200);
			expect(initial).toEqual({
				publicKey: expect.stringMatching(/^[A-Za-z0-9_-]{87}$/),
				preferences: {bankConnections: true, recurringBills: true},
			});

			await subscribe(owner.agent, 'register');
			// Registering again refreshes the same row.
			await subscribe(owner.agent, 'register');
			expect(await subscriptions.findBy({accountId: owner.id})).toEqual([
				expect.objectContaining({endpoint: endpoint('register'), p256dh: P256DH, auth: AUTH}),
			]);

			const {body: updated} = await owner.agent
				.patch('/notifications/preferences')
				.set('Origin', ORIGIN)
				.send({recurringBills: false})
				.expect(200);
			expect(updated.preferences).toEqual({bankConnections: true, recurringBills: false});
			expect((await owner.agent.get('/notifications').expect(200)).body.preferences).toEqual({
				bankConnections: true,
				recurringBills: false,
			});

			await owner.agent
				.delete('/notifications/subscriptions')
				.set('Origin', ORIGIN)
				.send({endpoint: endpoint('register')})
				.expect(204);
			expect(await subscriptions.countBy({accountId: owner.id})).toBe(0);
		});

		it.each([
			[
				'an endpoint outside the browser push services',
				{...registration('x'), endpoint: 'https://example.test/push'},
			],
			['a plain http endpoint', {...registration('x'), endpoint: 'http://fcm.googleapis.com/fcm/send/x'}],
			['missing keys', {endpoint: endpoint('x')}],
			['malformed keys', {...registration('x'), keys: {p256dh: 'not base64!', auth: AUTH}}],
		])('refuses a subscription with %s', async (_case, body) => {
			const owner = await createVerifiedAccount(httpServer, mailpitUrl);
			await owner.agent.put('/notifications/subscriptions').set('Origin', ORIGIN).send(body).expect(400);
			expect(await subscriptions.countBy({accountId: owner.id})).toBe(0);
		});

		it('refuses changes from another origin', async () => {
			const owner = await createVerifiedAccount(httpServer, mailpitUrl);
			await owner.agent
				.put('/notifications/subscriptions')
				.set('Origin', 'https://attacker.example.test')
				.send(registration('csrf'))
				.expect(403);
			await owner.agent.patch('/notifications/preferences').send({bankConnections: false}).expect(403);
			expect(await subscriptions.countBy({accountId: owner.id})).toBe(0);
		});

		it("keeps each owner's subscriptions to that owner", async () => {
			const owner = await subscribedOwner('owner-device');
			const other = await createVerifiedAccount(httpServer, mailpitUrl);

			// Another owner cannot remove it by endpoint.
			await other.agent
				.delete('/notifications/subscriptions')
				.set('Origin', ORIGIN)
				.send({endpoint: endpoint('owner-device')})
				.expect(204);
			expect(await subscriptions.countBy({accountId: owner.id})).toBe(1);

			// The same browser signed in as someone else now belongs to them.
			await subscribe(other.agent, 'owner-device');
			expect(await subscriptions.findBy({endpoint: endpoint('owner-device')})).toEqual([
				expect.objectContaining({accountId: other.id}),
			]);
		});

		it("logging out removes that session's subscriptions only", async () => {
			const owner = await subscribedOwner('laptop');
			const phone = await loginAgent(httpServer, owner.credentials.email, owner.credentials.password);
			await subscribe(phone, 'phone');

			await owner.agent.post('/auth/logout').expect(200);

			expect((await subscriptions.findBy({accountId: owner.id})).map((row) => row.endpoint)).toEqual([
				endpoint('phone'),
			]);
		});

		it('deleting the account removes its subscriptions and alert choices', async () => {
			const owner = await subscribedOwner('deleted');
			await owner.agent.patch('/notifications/preferences').set('Origin', ORIGIN).send({bankConnections: false});

			await owner.agent.delete('/accounts/me').send({password: owner.credentials.password}).expect(200);

			expect(await subscriptions.countBy({accountId: owner.id})).toBe(0);
			const [{count}] = await accounts.query(
				'SELECT count(*)::int AS count FROM push_preferences WHERE "accountId" = $1',
				[owner.id],
			);
			expect(count).toBe(0);
		});
	});

	describe('bank connection alerts', () => {
		it('pushes once per episode, next to the email, with vague text and the badge count', async () => {
			const owner = await subscribedOwner('bank-once');
			const connection = await createBrokenConnection(owner.id);
			const bankAccount = await fixtures.createBankAccount(connection, {name: 'Synthetic Savings'});
			await fixtures.createTransaction(bankAccount, {
				amount: '-987.65',
				counterpartyName: 'Example Shop',
				category: 'NEEDS_REVIEW',
			});

			await bankAlerts.scan(daytime());
			await bankAlerts.scan(daytime());
			await deliverDuePushes();

			expect(sentPushes()).toEqual([
				{
					endpoint: endpoint('bank-once'),
					payload: {
						title: 'Tempo',
						body: 'A bank has stopped syncing',
						url: `${webBaseUrl}/bank-connections`,
						tag: 'bank-connections',
						badge: 1,
					},
				},
			]);
			const serialized = JSON.stringify(sentPushes());
			for (const privateValue of [BANK_NAME, 'Synthetic Savings', 'Example Shop', '987', connection.id]) {
				expect(serialized).not.toContain(privateValue);
			}
		});

		it('says when consent is ending and when it is the last day', async () => {
			const owner = await subscribedOwner('consent');
			const connection = await createBrokenConnection(owner.id, {
				consentValidUntil: new Date(Date.now() + 3 * DAY),
				lastSyncedAt: new Date(),
				syncStatus: 'SUCCEEDED',
			});

			await bankAlerts.scan(daytime());
			await deliverDuePushes();
			await app.get(getRepositoryToken(BankConnection)).update(connection.id, {
				consentValidUntil: new Date(Date.now() + 20 * HOUR),
			});
			await bankAlerts.scan(daytime());
			await deliverDuePushes();

			expect(sentPushes().map(({payload}) => payload.body)).toEqual([
				'A bank needs re-authorizing soon',
				'Last day to re-authorize a bank',
			]);
		});

		it('holds a night alert until 09:00 and queues it once', async () => {
			const owner = await subscribedOwner('night');
			await createBrokenConnection(owner.id);
			const night = nextNight();

			await bankAlerts.scan(night);
			await bankAlerts.scan(new Date(night.getTime() + HOUR));

			const held = (await pushQueue.getJobs(['delayed'])).filter((job) => job.data.accountId === owner.id);
			expect(held).toHaveLength(1);
			expect(held[0].name).toBe(DELIVER_PUSH_ALERT_JOB);
			const morning = pushAlertDeliveryTime(night);
			expect(alertDateTime(morning)).toBe('09:00');
			expect(held[0].opts.delay).toBe(morning.getTime() - night.getTime());
			expect(send).not.toHaveBeenCalled();

			await held[0].promote();
			await deliverDuePushes();
			expect(sentPushes()).toEqual([expect.objectContaining({endpoint: endpoint('night')})]);
		});

		it('drops an alert that no longer applies when it is delivered', async () => {
			const owner = await subscribedOwner('recovered');
			const connection = await createBrokenConnection(owner.id);
			await bankAlerts.scan(nextNight());

			// The bank syncs again before the morning.
			await fixtures.createSyncRun(connection, {finishedAt: new Date()});
			const [held] = (await pushQueue.getJobs(['delayed'])).filter((job) => job.data.accountId === owner.id);
			await held.promote();
			await deliverDuePushes();

			expect(send).not.toHaveBeenCalled();
		});

		it('pushes nothing when the owner turned bank alerts off', async () => {
			const owner = await subscribedOwner('bank-off');
			await owner.agent.patch('/notifications/preferences').set('Origin', ORIGIN).send({bankConnections: false});
			await createBrokenConnection(owner.id);

			await bankAlerts.scan(daytime());
			await deliverDuePushes();

			expect(send).not.toHaveBeenCalled();
		});

		it('skips and removes devices whose session ended or that the push service reports gone', async () => {
			const owner = await subscribedOwner('signed-out');
			const second = await loginAgent(httpServer, owner.credentials.email, owner.credentials.password);
			await subscribe(second, 'gone');
			const third = await loginAgent(httpServer, owner.credentials.email, owner.credentials.password);
			await subscribe(third, 'kept');
			// The first session is revoked from another device; its row stays until a push finds it.
			const {sessionId} = await subscriptions.findOneByOrFail({endpoint: endpoint('signed-out')});
			await third.delete(`/auth/sessions/${sessionId}`).expect(200);
			send.mockImplementation(async ({endpoint: target}) => {
				if (target === endpoint('gone')) throw new WebPushError('Gone', 410, {}, '', target);
			});
			await createBrokenConnection(owner.id);

			try {
				await bankAlerts.scan(daytime());
				await deliverDuePushes();
			} finally {
				send.mockResolvedValue(undefined);
			}

			expect(
				sentPushes()
					.map(({endpoint: target}) => target)
					.sort(),
			).toEqual([endpoint('gone'), endpoint('kept')]);
			expect((await subscriptions.findBy({accountId: owner.id})).map((row) => row.endpoint)).toEqual([
				endpoint('kept'),
			]);
		});
	});

	describe('recurring bill alerts', () => {
		it('pushes once per series and period when a bill is late or higher than usual', async () => {
			const owner = await subscribedOwner('bills');
			await accounts.update({id: owner.id}, {baseCurrency: 'EUR'});
			const bank = await fixtures.createBankAccount(await fixtures.createConnection({id: owner.id}));
			const today = alertDate(daytime());
			// Weekly, last paid nine days ago: due two days ago.
			const late = [37, 30, 23, 16, 9].map((days) =>
				bookedRow(daysBefore(today, days), '-9.99', {
					counterpartyName: 'Example Streaming',
					description: 'Example Streaming',
					category: 'SUBSCRIPTIONS',
				}),
			);
			// Monthly on the 5th, the latest well above the rest.
			const latestFifth = today.slice(8) > '05' ? 0 : 1;
			const higher = ['61.00', '95.00', '48.00', '80.00', '77.00', '160.00'].map((amount, index) =>
				bookedRow(fifthMonthsBefore(today, latestFifth + 5 - index), `-${amount}`, {
					counterpartyName: 'Example Energy',
					description: 'Example Energy',
					category: 'UTILITIES',
				}),
			);
			await fixtures.createTransactions(bank, [...late, ...higher]);
			const {body} = await owner.agent.get('/recurring-series').query({asOf: today}).expect(200);
			const keyOf = (name: string) =>
				(body.expenses.series as {key: string; name: string}[]).find((series) => series.name === name)!.key;

			await billAlerts.scan(daytime());
			await billAlerts.scan(daytime());
			await deliverDuePushes();

			expect(
				sentPushes()
					.map(({payload}) => payload)
					.sort((a, b) => String(a.body).localeCompare(String(b.body))),
			).toEqual([
				{
					title: 'Tempo',
					body: 'A bill is higher than usual',
					url: `${webBaseUrl}/?recurring=open&series=${keyOf('Example Energy')}`,
					tag: `recurring-${keyOf('Example Energy')}`,
					badge: 0,
				},
				{
					title: 'Tempo',
					body: 'A bill is late',
					url: `${webBaseUrl}/?recurring=open&series=${keyOf('Example Streaming')}`,
					tag: `recurring-${keyOf('Example Streaming')}`,
					badge: 0,
				},
			]);
			expect(JSON.stringify(sentPushes())).not.toMatch(/Example|160|9\.99/);
		});

		it('reads no bills for owners who turned bill alerts off', async () => {
			const owner = await subscribedOwner('bills-off');
			await owner.agent.patch('/notifications/preferences').set('Origin', ORIGIN).send({recurringBills: false});
			const list = jest.spyOn(app.get(PushNotificationService), 'findAccountIdsReceiving');

			await billAlerts.scan(daytime());

			expect(await list.mock.results[0].value).not.toContain(owner.id);
			list.mockRestore();
		});
	});
});

/** `HH:MM` in Amsterdam. */
function alertDateTime(instant: Date): string {
	return new Intl.DateTimeFormat('en-GB', {
		timeZone: 'Europe/Amsterdam',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
	}).format(instant);
}
