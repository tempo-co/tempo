import {Injectable} from '@nestjs/common';
import webPush from 'web-push';

import {ConfigurationService} from '@core/config/config.service';

import type {PushSubscription} from './push-subscription.entity';

/** A day: an alert older than that is stale, so the push service may drop it. */
const PUSH_TTL_SECONDS = 24 * 60 * 60;
/** A push service that does not answer must not hold up the alerts queued behind it. */
const PUSH_TIMEOUT_MS = 10_000;

/**
 * The only code that talks to browser push services (Apple, Google, Mozilla, Microsoft). Payloads are encrypted for
 * the subscribing browser. Failures throw `WebPushError` with the push service's status code.
 */
@Injectable()
export class WebPushSender {
	private readonly vapid: {publicKey: string; privateKey: string; subject: string} | null;

	constructor(config: ConfigurationService) {
		const publicKey = config.get('WEB_PUSH_VAPID_PUBLIC_KEY');
		const privateKey = config.get('WEB_PUSH_VAPID_PRIVATE_KEY');
		const subject = config.get('WEB_PUSH_VAPID_SUBJECT');
		this.vapid = publicKey && privateKey && subject ? {publicKey, privateKey, subject} : null;
	}

	/** The key browsers subscribe with; null when this server has no VAPID keys and sends no push. */
	get publicKey(): string | null {
		return this.vapid?.publicKey ?? null;
	}

	async send(subscription: Pick<PushSubscription, 'endpoint' | 'p256dh' | 'auth'>, payload: string): Promise<void> {
		if (!this.vapid) return;
		await webPush.sendNotification(
			{endpoint: subscription.endpoint, keys: {p256dh: subscription.p256dh, auth: subscription.auth}},
			payload,
			{vapidDetails: this.vapid, TTL: PUSH_TTL_SECONDS, urgency: 'normal', timeout: PUSH_TIMEOUT_MS},
		);
	}
}
