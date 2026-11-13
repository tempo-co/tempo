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
import {APP_TIME_ZONE} from '@core/time/app-time-zone';
import {Account} from '@modules/account/account.entity';
import {BankConnectionAlertService} from '@modules/banking/alerts/bank-connection-alert.service';
import {BankConnection} from '@modules/banking/bank-connection.entity';
import {pushAlertDeliveryTime} from '@modules/notifications/push-alert-hours';
import {PushSubscription} from '@modules/notifications/push-subscription.entity';
import {WebPushSender} from '@modules/notifications/web-push.sender';

import {BankingFixtures} from '../../../scripts/seed-data/banking-fixtures';
import {enableWebPushE2e, getApp, loginAgent} from '../../setup/e2e.setup';
import {createVerifiedAccount} from '../../utils/auth-utils';
import {MAILPIT_API_URL} from '../../utils/email-utils';
import {waitFor} from '../../utils/wait-utils';

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

describe('Push notifications', () => {
	jest.setTimeout(30_000);

	let app: INestApplication;
	let httpServer: Server;
	let fixtures: BankingFixtures;
	let accounts: Repository<Account>;
	let subscriptions: Repository<PushSubscription>;
	let pushQueue: Queue;
	let bankAlerts: BankConnectionAlertService;
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
		const config = app.get(ConfigurationService);
		mailpitUrl = MAILPIT_API_URL;
		webBaseUrl = config.get('WEB_BASE_URL');
		send = jest.spyOn(app.get(WebPushSender), 'send').mockResolvedValue(undefined);
	});

	beforeEach(() => send.mockClear());

	afterAll(() => {
		jest.restoreAllMocks();
	});

	/** A new verified owner, signed in, with this browser subscribed; signed up without a time zone unless given one. */
	async function subscribedOwner(name: string, timeZone?: string) {
		const owner = await createVerifiedAccount(httpServer, mailpitUrl, {timeZone});
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
		await waitFor(
			() => pushQueue.getJobCounts('waiting', 'active', 'prioritized'),
			(counts) => Object.values(counts).every((count) => count === 0),
		);
	}

	/** A time during the day for an owner in the default zone, at or just after now, so alerts are not held. */
	const daytime = () => pushAlertDeliveryTime(new Date(), APP_TIME_ZONE);

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
		it('registers this browser, saves the bank alert choice and removes the subscription again', async () => {
			const owner = await createVerifiedAccount(httpServer, mailpitUrl);

			const {body: initial} = await owner.agent.get('/notifications').expect(200);
			expect(initial).toEqual({
				publicKey: expect.stringMatching(/^[A-Za-z0-9_-]{87}$/),
				preferences: {bankConnections: true},
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
				.send({bankConnections: false})
				.expect(200);
			expect(updated.preferences).toEqual({bankConnections: false});
			expect((await owner.agent.get('/notifications').expect(200)).body.preferences).toEqual({
				bankConnections: false,
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

		it.each([
			['null', {bankConnections: null}],
			['a string', {bankConnections: 'yes'}],
		])('refuses an alert choice that is %s', async (_case, body) => {
			const owner = await createVerifiedAccount(httpServer, mailpitUrl);
			await owner.agent.patch('/notifications/preferences').set('Origin', ORIGIN).send(body).expect(400);
			expect((await owner.agent.get('/notifications').expect(200)).body.preferences).toEqual({
				bankConnections: true,
			});
		});

		it('refuses changes from another origin', async () => {
			const owner = await createVerifiedAccount(httpServer, mailpitUrl);
			await owner.agent
				.put('/notifications/subscriptions')
				.set('Origin', 'https://attacker.example.test')
				.send(registration('csrf'))
				.expect(403);
			await owner.agent
				.patch('/notifications/preferences')
				.unset('Origin')
				.send({bankConnections: false})
				.expect(403);
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
			const morning = pushAlertDeliveryTime(night, APP_TIME_ZONE);
			expect(alertTime(morning, APP_TIME_ZONE)).toBe('09:00');
			expect(held[0].opts.delay).toBe(morning.getTime() - night.getTime());
			expect(send).not.toHaveBeenCalled();

			await held[0].promote();
			await deliverDuePushes();
			expect(sentPushes()).toEqual([expect.objectContaining({endpoint: endpoint('night')})]);
		});

		it("times alerts in each owner's time zone", async () => {
			const lisbon = await subscribedOwner('lisbon', 'Europe/Lisbon');
			const helsinki = await subscribedOwner('helsinki', 'Europe/Helsinki');
			await createBrokenConnection(lisbon.id);
			await createBrokenConnection(helsinki.id);
			// One instant: 20:30 in Lisbon, 22:30 in Helsinki.
			const instant = nextWallTime('Europe/Lisbon', '20:30');
			expect(alertTime(instant, 'Europe/Helsinki')).toBe('22:30');

			await bankAlerts.scan(instant);
			await deliverDuePushes();

			expect(sentPushes()).toEqual([expect.objectContaining({endpoint: endpoint('lisbon')})]);
			const held = (await pushQueue.getJobs(['delayed'])).filter((job) => job.data.accountId === helsinki.id);
			expect(held).toHaveLength(1);
			const morning = new Date(instant.getTime() + held[0].opts.delay!);
			expect(alertTime(morning, 'Europe/Helsinki')).toBe('09:00');
			expect(morning.getTime() - instant.getTime()).toBeLessThan(12 * HOUR);
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
});

/** The first whole half hour after now that reads `HH:MM` (`hourMinute`) in `timeZone`. */
function nextWallTime(timeZone: string, hourMinute: string): Date {
	const halfHour = 30 * 60 * 1000;
	const start = Math.ceil(Date.now() / halfHour) * halfHour;
	for (let instant = start; instant < start + 2 * 24 * 60 * 60 * 1000; instant += halfHour) {
		if (alertTime(new Date(instant), timeZone) === hourMinute) return new Date(instant);
	}
	throw new Error(`No ${hourMinute} in ${timeZone} within two days.`);
}

/** `HH:MM` in `timeZone`. */
function alertTime(instant: Date, timeZone: string): string {
	return new Intl.DateTimeFormat('en-GB', {
		timeZone,
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
	}).format(instant);
}
