import {Processor, WorkerHost} from '@nestjs/bullmq';
import type {RecurringSeriesFlag} from '@tempo/contracts';
import {Job} from 'bullmq';

import {ConfigurationService} from '@core/config/config.service';
import {createWebUrl} from '@core/config/web-url';
import {DELIVER_PUSH_ALERT_JOB, PUSH_NOTIFICATION_QUEUE} from '@core/queue/queue.constants';
import {
	type PushAlert,
	type PushAlertJob,
	PushNotificationService,
	type PushPayload,
} from '@modules/notifications/push-notification.service';

import {BankTransactionSummaryService} from '../services/bank-transaction-summary.service';
import {BankConnectionAlertService} from './bank-connection-alert.service';
import type {BankConnectionAlert} from './bank-connection-alerts';
import {RecurringBillAlertService} from './recurring-bill-alert.service';

const TITLE = 'Tempo';
/** What each alert says. Vague on purpose: a notification can be read on a locked screen without opening Tempo. */
const BODIES: Record<BankConnectionAlert | RecurringSeriesFlag, string> = {
	CONSENT_EXPIRING: 'A bank needs re-authorizing soon',
	CONSENT_FINAL: 'Last day to re-authorize a bank',
	SYNC_BROKEN: 'A bank has stopped syncing',
	LATE: 'A bill is late',
	HIGHER_THAN_USUAL: 'A bill is higher than usual',
};

/**
 * Delivers queued push alerts. An alert waits until morning when raised at night, so it is checked again first:
 * one that no longer applies (a reauthorized bank, a paid bill) is dropped. The app badge count travels with it.
 */
@Processor(PUSH_NOTIFICATION_QUEUE)
export class PushAlertProcessor extends WorkerHost {
	constructor(
		private readonly pushNotificationService: PushNotificationService,
		private readonly bankConnectionAlertService: BankConnectionAlertService,
		private readonly recurringBillAlertService: RecurringBillAlertService,
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
		if (!(await this.isStillDue(accountId, alert, now))) return 0;
		const {needsAttention} = await this.summaryService.getReviewCounts(accountId);
		const target =
			alert.kind === 'BANK_CONNECTION'
				? {body: BODIES[alert.alert], url: this.webUrl('/bank-connections'), tag: 'bank-connections'}
				: {
						body: BODIES[alert.flag],
						url: this.webUrl('/', {recurring: 'open', series: alert.seriesKey}),
						tag: `recurring-${alert.seriesKey}`,
					};
		const payload: PushPayload = {title: TITLE, ...target, badge: needsAttention};
		return this.pushNotificationService.deliver(
			accountId,
			alert.kind === 'BANK_CONNECTION' ? 'bankConnections' : 'recurringBills',
			payload,
		);
	}

	private isStillDue(accountId: string, alert: PushAlert, now: Date): Promise<boolean> {
		return alert.kind === 'BANK_CONNECTION'
			? this.bankConnectionAlertService.isStillDue(
					accountId,
					alert.connectionId,
					alert.alert,
					new Date(alert.episode),
					now,
				)
			: this.recurringBillAlertService.isStillDue(accountId, alert, now);
	}

	private webUrl(path: string, params?: Record<string, string>): string {
		return createWebUrl(path, this.configurationService.get('WEB_BASE_URL'), params);
	}
}
