import {Processor, WorkerHost} from '@nestjs/bullmq';
import {Job} from 'bullmq';

import {ConfigurationService} from '@core/config/config.service';
import {createWebUrl} from '@core/config/web-url';
import {DELIVER_PUSH_ALERT_JOB, PUSH_NOTIFICATION_QUEUE} from '@core/queue/queue.constants';
import {type PushAlertJob, PushNotificationService} from '@modules/notifications/push-notification.service';

import {BankTransactionSummaryService} from '../services/bank-transaction-summary.service';
import {BankConnectionAlertService} from './bank-connection-alert.service';
import type {BankConnectionAlert} from './bank-connection-alerts';

const TITLE = 'Tempo';
/** What each alert says. Vague on purpose: a notification can be read on a locked screen without opening Tempo. */
const BODIES: Record<BankConnectionAlert, string> = {
	CONSENT_EXPIRING: 'A bank needs re-authorizing soon',
	CONSENT_FINAL: 'Last day to re-authorize a bank',
	SYNC_BROKEN: 'A bank has stopped syncing',
};

/**
 * Delivers queued push alerts. An alert waits until morning when raised at night, so it is checked again first:
 * one that no longer applies (a reauthorized or synced bank) is dropped. The app badge count travels with it.
 */
@Processor(PUSH_NOTIFICATION_QUEUE)
export class PushAlertProcessor extends WorkerHost {
	constructor(
		private readonly pushNotificationService: PushNotificationService,
		private readonly bankConnectionAlertService: BankConnectionAlertService,
		private readonly summaryService: BankTransactionSummaryService,
		private readonly configurationService: ConfigurationService,
	) {
		super();
	}

	async process(job: Job<PushAlertJob>): Promise<void> {
		if (job.name !== DELIVER_PUSH_ALERT_JOB) return;
		await this.deliver(job.data);
	}

	/** Pushes one alert if it still applies; resolves to the number of devices it reached. */
	async deliver({accountId, alert}: PushAlertJob, now = new Date()): Promise<number> {
		const stillDue = await this.bankConnectionAlertService.isStillDue(
			accountId,
			alert.connectionId,
			alert.alert,
			new Date(alert.episode),
			now,
		);
		if (!stillDue) return 0;
		const {needsAttention} = await this.summaryService.getReviewCounts(accountId);
		return this.pushNotificationService.deliver(accountId, {
			title: TITLE,
			body: BODIES[alert.alert],
			url: createWebUrl('/bank-connections', this.configurationService.get('WEB_BASE_URL')),
			tag: 'bank-connections',
			badge: needsAttention,
		});
	}
}
