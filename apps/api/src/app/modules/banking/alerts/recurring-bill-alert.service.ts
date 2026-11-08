import {InjectQueue} from '@nestjs/bullmq';
import {Injectable, Logger, OnModuleInit} from '@nestjs/common';
import {InjectDataSource} from '@nestjs/typeorm';
import type {RecurringSeries, RecurringSeriesFlag} from '@tempo/contracts';
import {Queue} from 'bullmq';
import {DataSource} from 'typeorm';

import {ConfigurationService} from '@core/config/config.service';
import {bootstrapJobScheduler} from '@core/queue/job-scheduler';
import {
	BANK_CONNECTION_ALERT_QUEUE,
	RECURRING_BILL_ALERT_SCHEDULER_ID,
	SCAN_RECURRING_BILL_ALERTS_JOB,
} from '@core/queue/queue.constants';
import {Account} from '@modules/account/account.entity';
import {alertDate} from '@modules/notifications/push-alert-hours';
import {PushNotificationService} from '@modules/notifications/push-notification.service';

import {safeErrorName} from '../banking.utils';
import {RecurringSeriesService} from '../recurring/recurring-series.service';
import {RecurringBillAlert} from './recurring-bill-alert.entity';

const SCAN_INTERVAL_MS = 60 * 60 * 1000;

/** A shown, active bill with a flag, and the period the flag is about. */
type DueBillAlert = {seriesKey: string; flag: RecurringSeriesFlag; period: string};

/**
 * Pushes once per series and period when a recurring bill is late (its due date passed without a payment) or its
 * latest payment is higher than usual. Only owners with a device and bill alerts on are read. Bills are dated in the
 * alert time zone.
 */
@Injectable()
export class RecurringBillAlertService implements OnModuleInit {
	private readonly logger = new Logger(RecurringBillAlertService.name);

	constructor(
		@InjectDataSource() private readonly dataSource: DataSource,
		@InjectQueue(BANK_CONNECTION_ALERT_QUEUE) private readonly queue: Queue,
		private readonly configurationService: ConfigurationService,
		private readonly recurringSeriesService: RecurringSeriesService,
		private readonly pushNotificationService: PushNotificationService,
	) {}

	isEnabled(): boolean {
		return this.configurationService.get('BANKING_INTEGRATION_ENABLED') !== false;
	}

	async onModuleInit(): Promise<void> {
		await bootstrapJobScheduler(
			this.queue,
			{
				schedulerId: RECURRING_BILL_ALERT_SCHEDULER_ID,
				jobName: SCAN_RECURRING_BILL_ALERTS_JOB,
				everyMs: SCAN_INTERVAL_MS,
			},
			{enabled: this.isEnabled(), configurationService: this.configurationService, logger: this.logger},
		);
	}

	async scan(now = new Date()): Promise<number> {
		if (!this.isEnabled()) return 0;
		let raised = 0;
		for (const accountId of await this.pushNotificationService.findAccountIdsReceiving('recurringBills')) {
			try {
				raised += await this.alertAccount(accountId, now);
			} catch (error) {
				this.logger.warn(`Recurring bill alert failed for ${accountId}: ${safeErrorName(error)}`);
			}
		}
		return raised;
	}

	/** Whether an alert raised earlier is still due at `now`: the bill still has that flag for that period. */
	async isStillDue(accountId: Account['id'], alert: DueBillAlert, now = new Date()): Promise<boolean> {
		const due = await this.dueAlerts(accountId, now);
		return due.some(
			({seriesKey, flag, period}) =>
				seriesKey === alert.seriesKey && flag === alert.flag && period === alert.period,
		);
	}

	private async alertAccount(accountId: Account['id'], now: Date): Promise<number> {
		let raised = 0;
		for (const alert of await this.dueAlerts(accountId, now)) {
			if (await this.raise(accountId, alert, now)) raised++;
		}
		return raised;
	}

	/** Records the alert and queues its push in one transaction; an alert already recorded is not queued again. */
	private raise(accountId: Account['id'], {seriesKey, flag, period}: DueBillAlert, now: Date): Promise<boolean> {
		return this.dataSource.transaction(async (manager) => {
			const inserted = await manager
				.createQueryBuilder()
				.insert()
				.into(RecurringBillAlert)
				.values({accountId, seriesKey, flag, period})
				.orIgnore()
				.returning(['id'])
				.execute();
			if ((inserted.raw as unknown[]).length === 0) return false;
			await this.pushNotificationService.queueAlert(
				{accountId, alert: {kind: 'RECURRING_BILL', flag, seriesKey, period}},
				`push-bill-alert-${accountId}-${seriesKey}-${flag}-${period}`,
				now,
			);
			return true;
		});
	}

	private async dueAlerts(accountId: Account['id'], now: Date): Promise<DueBillAlert[]> {
		const account = await this.dataSource.getRepository(Account).findOneBy({id: accountId});
		if (!account?.isEmailVerified) return [];
		const {expenses} = await this.recurringSeriesService.list(account, alertDate(now));
		return expenses.series
			.filter(({hidden, status}) => !hidden && status === 'ACTIVE')
			.flatMap((series) =>
				series.flags.map((flag) => ({seriesKey: series.key, flag, period: alertPeriod(series, flag)})),
			);
	}
}

/** The missed due date for LATE; the higher payment's date for HIGHER_THAN_USUAL. */
function alertPeriod(
	series: Pick<RecurringSeries, 'nextExpectedDate' | 'lastDate'>,
	flag: RecurringSeriesFlag,
): string {
	return flag === 'LATE' ? series.nextExpectedDate : series.lastDate;
}
