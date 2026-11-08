import {InjectQueue} from '@nestjs/bullmq';
import {Injectable, Logger} from '@nestjs/common';
import {InjectRepository} from '@nestjs/typeorm';
import type {
	NotificationPreferences,
	NotificationPreferencesUpdate,
	NotificationSettings,
	PushSubscriptionRegistration,
	RecurringSeriesFlag,
} from '@tempo/contracts';
import {Queue} from 'bullmq';
import {In, Repository} from 'typeorm';
import {WebPushError} from 'web-push';

import {DELIVER_PUSH_ALERT_JOB, PUSH_NOTIFICATION_QUEUE} from '@core/queue/queue.constants';
import {SessionService} from '@core/session/session.service';
import {Account} from '@modules/account/account.entity';

import {pushAlertDeliveryTime} from './push-alert-hours';
import {PushPreferences} from './push-preferences.entity';
import {PushSubscription} from './push-subscription.entity';
import {WebPushSender} from './web-push.sender';

/** An alert to push, by ids only; the worker reads everything else when it delivers. */
export type PushAlert =
	| {
			kind: 'BANK_CONNECTION';
			alert: 'CONSENT_EXPIRING' | 'CONSENT_FINAL' | 'SYNC_BROKEN';
			connectionId: string;
			/** The episode's marker value (ISO timestamp) the alert was raised for. */
			episode: string;
	  }
	| {kind: 'RECURRING_BILL'; flag: RecurringSeriesFlag; seriesKey: string; period: string};

export type PushAlertJob = {accountId: string; alert: PushAlert};

/** What the service worker shows. Kept vague: no bank, merchant, account or amount. */
export type PushPayload = {title: string; body: string; url: string; tag: string; badge: number};

const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {bankConnections: true, recurringBills: true};
/** Delivered push jobs stay a week, so a retried scan cannot queue the same alert again. */
const IDEMPOTENT_JOB_RETENTION = {age: 7 * 24 * 60 * 60};
/** Status codes with which a push service says the subscription is gone for good. */
const GONE_STATUS_CODES = new Set([404, 410]);

/** Every device failed for a reason other than being gone; the job is retried. */
class PushDeliveryError extends Error {
	constructor() {
		super('No device accepted the push.');
		this.name = 'PushDeliveryError';
	}
}

@Injectable()
export class PushNotificationService {
	private readonly logger = new Logger(PushNotificationService.name);

	constructor(
		@InjectRepository(PushSubscription) private readonly subscriptions: Repository<PushSubscription>,
		@InjectRepository(PushPreferences) private readonly preferences: Repository<PushPreferences>,
		@InjectQueue(PUSH_NOTIFICATION_QUEUE) private readonly queue: Queue<PushAlertJob>,
		private readonly sender: WebPushSender,
		private readonly sessionService: SessionService,
	) {}

	async getSettings(accountId: Account['id']): Promise<NotificationSettings> {
		return {publicKey: this.sender.publicKey, preferences: await this.getPreferences(accountId)};
	}

	async updatePreferences(
		accountId: Account['id'],
		update: NotificationPreferencesUpdate,
	): Promise<NotificationSettings> {
		// Write only the choices sent, so two quick toggles of different alerts cannot undo each other.
		const changed = Object.fromEntries(Object.entries(update).filter(([, value]) => value !== undefined));
		if (Object.keys(changed).length > 0) {
			await this.preferences.upsert({accountId, ...changed}, ['accountId']);
		}
		return this.getSettings(accountId);
	}

	/** Saves this browser's subscription for the session's owner; an endpoint another owner registered moves over. */
	async register(
		accountId: Account['id'],
		sessionId: string,
		{endpoint, keys}: PushSubscriptionRegistration,
	): Promise<void> {
		await this.subscriptions.upsert({accountId, sessionId, endpoint, p256dh: keys.p256dh, auth: keys.auth}, [
			'endpoint',
		]);
	}

	async remove(accountId: Account['id'], endpoint: string): Promise<void> {
		await this.subscriptions.delete({accountId, endpoint});
	}

	/** Logging out removes the subscriptions that session registered. */
	async removeForSession(accountId: Account['id'], sessionId: string): Promise<void> {
		await this.subscriptions.delete({accountId, sessionId});
	}

	/** Whether this server has VAPID keys, without which nothing is pushed. */
	isConfigured(): boolean {
		return this.sender.publicKey !== null;
	}

	/** Owners with at least one device and this alert kind on. */
	async findAccountIdsReceiving(kind: keyof NotificationPreferences): Promise<string[]> {
		const rows = await this.subscriptions
			.createQueryBuilder('subscription')
			.select('DISTINCT subscription.accountId', 'accountId')
			.leftJoin(PushPreferences, 'preferences', 'preferences.accountId = subscription.accountId')
			.where(`COALESCE(preferences.${kind}, true)`)
			.orderBy('subscription.accountId')
			.getRawMany<{accountId: string}>();
		return rows.map(({accountId}) => accountId);
	}

	/**
	 * Queues one alert for delivery, when this server sends push; between 21:00 and 09:00 it waits until 09:00. The job id is the alert's identity,
	 * so queueing it again while it waits or within a week of delivery adds nothing.
	 */
	async queueAlert(job: PushAlertJob, jobId: string, now = new Date()): Promise<void> {
		if (!this.isConfigured()) return;
		const delay = pushAlertDeliveryTime(now).getTime() - now.getTime();
		await this.queue.add(DELIVER_PUSH_ALERT_JOB, job, {
			jobId,
			delay,
			removeOnComplete: IDEMPOTENT_JOB_RETENTION,
			removeOnFail: IDEMPOTENT_JOB_RETENTION,
		});
	}

	/**
	 * Pushes to every device of the owner whose session is still signed in, if the owner wants this alert kind.
	 * Subscriptions of ended sessions, and ones the push service reports gone, are removed. Throws only when every
	 * device failed for another reason, so a retry cannot push twice to a device that got it; cleanup that fails
	 * after a send is logged instead.
	 */
	async deliver(
		accountId: Account['id'],
		kind: keyof NotificationPreferences,
		payload: PushPayload,
	): Promise<number> {
		if (!this.isConfigured() || !(await this.getPreferences(accountId))[kind]) return 0;
		const subscriptions = await this.subscriptions.find({where: {accountId}, order: {createdAt: 'ASC'}});
		const active = await this.sessionService.findActiveSessionIds(
			accountId,
			subscriptions.map(({sessionId}) => sessionId),
		);
		const ended = subscriptions.filter(({sessionId}) => !active.has(sessionId));
		if (ended.length > 0) await this.subscriptions.delete({accountId, id: In(ended.map(({id}) => id))});

		const body = JSON.stringify(payload);
		let sent = 0;
		let failed = 0;
		for (const subscription of subscriptions.filter(({sessionId}) => active.has(sessionId))) {
			try {
				await this.sender.send(subscription, body);
				sent++;
			} catch (error) {
				if (error instanceof WebPushError && GONE_STATUS_CODES.has(error.statusCode)) {
					await this.subscriptions.delete({accountId, id: subscription.id}).catch(() => {
						this.logger.warn('Removing a device the push service no longer knows failed.');
					});
					continue;
				}
				failed++;
				const status = error instanceof WebPushError ? error.statusCode : 'network';
				this.logger.warn(`Push to a device failed (${status}).`);
			}
		}
		if (failed > 0 && sent === 0) throw new PushDeliveryError();
		return sent;
	}

	private async getPreferences(accountId: Account['id']): Promise<NotificationPreferences> {
		const stored = await this.preferences.findOneBy({accountId});
		return stored
			? {bankConnections: stored.bankConnections, recurringBills: stored.recurringBills}
			: DEFAULT_NOTIFICATION_PREFERENCES;
	}
}
