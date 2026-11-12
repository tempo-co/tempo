import {InjectQueue} from '@nestjs/bullmq';
import {Injectable, Logger, OnModuleInit} from '@nestjs/common';
import {InjectDataSource} from '@nestjs/typeorm';
import {Queue} from 'bullmq';
import {DataSource, EntityManager, QueryDeepPartialEntity} from 'typeorm';

import {ConfigurationService} from '@core/config/config.service';
import {createWebUrl} from '@core/config/web-url';
import {EmailService} from '@core/email/email.service';
import {bootstrapJobScheduler} from '@core/queue/job-scheduler';
import {
	BANK_CONNECTION_ALERT_QUEUE,
	BANK_CONNECTION_ALERT_SCHEDULER_ID,
	SCAN_BANK_CONNECTION_ALERTS_JOB,
} from '@core/queue/queue.constants';
import {Account} from '@modules/account/account.entity';
import {PushNotificationService} from '@modules/notifications/push-notification.service';

import {BankConnection} from '../bank-connection.entity';
import {BankSyncRun} from '../bank-sync-run.entity';
import {safeErrorName} from '../banking.utils';
import {
	BANK_CONNECTION_PROVIDERS,
	BANK_CONNECTION_STATUSES,
	BANK_SYNC_STATUSES,
} from '../services/banking-sync.constants';
import {
	BANK_CONNECTION_ALERTS,
	BankConnectionAlert,
	BankConnectionAlertState,
	getDueBankConnectionAlerts,
} from './bank-connection-alerts';

const SCAN_INTERVAL_MS = 60 * 60 * 1000;
const ALERTABLE_STATUSES = [BANK_CONNECTION_STATUSES.AUTHORIZED, BANK_CONNECTION_STATUSES.EXPIRED];
// Copy the stored value in SQL so the marker compares equal at full database precision.
const CONSENT_MARKER_UPDATES: Record<
	Exclude<BankConnectionAlert, typeof BANK_CONNECTION_ALERTS.SYNC_BROKEN>,
	QueryDeepPartialEntity<BankConnection>
> = {
	[BANK_CONNECTION_ALERTS.CONSENT_EXPIRING]: {consentExpiringAlertFor: () => '"consentValidUntil"'},
	[BANK_CONNECTION_ALERTS.CONSENT_FINAL]: {consentFinalAlertFor: () => '"consentValidUntil"'},
};
const dateTimeFormat = new Intl.DateTimeFormat('en-GB', {
	dateStyle: 'long',
	timeStyle: 'short',
	timeZone: 'UTC',
});

@Injectable()
export class BankConnectionAlertService implements OnModuleInit {
	private readonly logger = new Logger(BankConnectionAlertService.name);

	constructor(
		@InjectDataSource() private readonly dataSource: DataSource,
		@InjectQueue(BANK_CONNECTION_ALERT_QUEUE) private readonly queue: Queue,
		private readonly emailService: EmailService,
		private readonly configurationService: ConfigurationService,
		private readonly pushNotificationService: PushNotificationService,
	) {}

	isEnabled(): boolean {
		return (
			this.configurationService.get('BANKING_INTEGRATION_ENABLED') !== false &&
			this.configurationService.get('BANK_CONNECTION_ALERTS_ENABLED') !== false
		);
	}

	async onModuleInit(): Promise<void> {
		await bootstrapJobScheduler(
			this.queue,
			{
				schedulerId: BANK_CONNECTION_ALERT_SCHEDULER_ID,
				jobName: SCAN_BANK_CONNECTION_ALERTS_JOB,
				everyMs: SCAN_INTERVAL_MS,
			},
			{enabled: this.isEnabled(), configurationService: this.configurationService, logger: this.logger},
		);
	}

	/** Emails and pushes each verified owner about connections whose consent is ending or that stopped syncing. */
	async scan(now = new Date()): Promise<number> {
		if (!this.isEnabled()) return 0;

		const candidates = await this.dataSource
			.getRepository(BankConnection)
			.createQueryBuilder('connection')
			.innerJoin('connection.account', 'account')
			.select('connection.id', 'id')
			.where('connection.status IN (:...statuses)', {statuses: ALERTABLE_STATUSES})
			// Imported files never sync, so they can neither expire nor stop syncing.
			.andWhere('connection.provider = :provider', {provider: BANK_CONNECTION_PROVIDERS.ENABLE_BANKING})
			.andWhere('account.isEmailVerified = true')
			.orderBy('connection.id', 'ASC')
			.getRawMany<{id: string}>();

		let sent = 0;
		for (const {id} of candidates) {
			try {
				sent += await this.alertConnection(id, now);
			} catch (error) {
				this.logger.warn(`Bank connection alert failed for ${id}: ${safeErrorName(error)}`);
			}
		}
		return sent;
	}

	private async alertConnection(connectionId: string, now: Date): Promise<number> {
		let sent = 0;
		for (const alert of Object.values(BANK_CONNECTION_ALERTS)) {
			if (await this.sendAlert(connectionId, alert, now)) sent++;
		}
		return sent;
	}

	/**
	 * Re-reads the connection under a row lock, records one alert as sent and queues its email and push in one
	 * transaction: concurrent scans and syncs wait for the marker, and a failed enqueue rolls back only this alert's
	 * marker. Both jobs are keyed by the episode, so the retry queues neither twice.
	 */
	private sendAlert(connectionId: string, alert: BankConnectionAlert, now: Date): Promise<boolean> {
		return this.dataSource.transaction(async (manager) => {
			const connection = await this.readAlertState(manager, {id: connectionId}, true);
			if (!connection) return false;
			if (!getDueBankConnectionAlerts(connection, now).includes(alert)) return false;

			const account = await manager.getRepository(Account).findOneBy({id: connection.accountId});
			if (!account?.isEmailVerified) return false;

			const isSyncAlert = alert === BANK_CONNECTION_ALERTS.SYNC_BROKEN;
			const episode = alertEpisode(connection, alert);
			await manager
				.createQueryBuilder()
				.update(BankConnection)
				.set(isSyncAlert ? {syncAlertFor: episode} : CONSENT_MARKER_UPDATES[alert])
				.where('id = :id', {id: connection.id})
				.execute();
			const jobId = `bank-alert-${connection.id}-${alert}-${episode.getTime()}`;
			await this.emailService.send(this.buildEmail(alert, connection, account), account.id, jobId);
			await this.pushNotificationService.queueAlert(
				{
					accountId: account.id,
					alert: {alert, connectionId: connection.id, episode: episode.toISOString()},
				},
				`push-${jobId}`,
				now,
			);
			return true;
		});
	}

	/**
	 * Whether an alert raised earlier still applies at `now`: the owner's connection is in the same episode and the
	 * alert would be due if it had not been sent. A reauthorization or successful sync since then ends it.
	 */
	async isStillDue(
		accountId: Account['id'],
		connectionId: BankConnection['id'],
		alert: BankConnectionAlert,
		episode: Date,
		now = new Date(),
	): Promise<boolean> {
		const connection = await this.readAlertState(this.dataSource.manager, {id: connectionId, accountId}, false);
		if (!connection || alertEpisode(connection, alert).getTime() !== episode.getTime()) return false;
		const unsent = {...connection, consentExpiringAlertFor: null, consentFinalAlertFor: null, syncAlertFor: null};
		return getDueBankConnectionAlerts(unsent, now).includes(alert);
	}

	private async readAlertState(
		manager: EntityManager,
		where: Pick<BankConnection, 'id'> & Partial<Pick<BankConnection, 'accountId'>>,
		lock: boolean,
	): Promise<(BankConnection & Pick<BankConnectionAlertState, 'lastSuccessfulSyncAt'>) | null> {
		const storedConnection = await manager.getRepository(BankConnection).findOne({
			where,
			...(lock ? {lock: {mode: 'pessimistic_write' as const}} : {}),
		});
		if (!storedConnection) return null;
		// lastSyncedAt also advances for PARTIAL runs that may not have fetched any bank data.
		const lastSuccess = await manager
			.getRepository(BankSyncRun)
			.createQueryBuilder('run')
			.select('MAX(run.finishedAt)', 'lastSuccessfulSyncAt')
			.where('run.bankConnectionId = :connectionId', {connectionId: storedConnection.id})
			.andWhere('run.status = :status', {status: BANK_SYNC_STATUSES.SUCCEEDED})
			.getRawOne<{lastSuccessfulSyncAt: Date | null}>();
		return {...storedConnection, lastSuccessfulSyncAt: lastSuccess?.lastSuccessfulSyncAt ?? null};
	}

	private buildEmail(
		alert: BankConnectionAlert,
		connection: BankConnection & Pick<BankConnectionAlertState, 'lastSuccessfulSyncAt'>,
		account: Account,
	) {
		const bankName = connection.aspspName;
		const bankConnectionsUrl = createWebUrl('/bank-connections', this.configurationService.get('WEB_BASE_URL'));

		if (alert === BANK_CONNECTION_ALERTS.SYNC_BROKEN) {
			const subject = `Tempo can't sync ${bankName}`;
			return {
				to: account.email,
				subject,
				template: 'bank-sync-broken',
				context: {
					subject,
					bankName,
					bankConnectionsUrl,
					reason: this.describeSyncProblem(connection),
					lastSyncDescription: connection.lastSuccessfulSyncAt
						? `The last successful sync was on ${formatDateTime(connection.lastSuccessfulSyncAt)}.`
						: 'It has not synced successfully since you connected it.',
				},
			};
		}

		const subject =
			alert === BANK_CONNECTION_ALERTS.CONSENT_FINAL
				? `Last day to reconnect ${bankName} in Tempo`
				: `Your ${bankName} connection to Tempo ends soon`;
		return {
			to: account.email,
			subject,
			template: 'bank-consent-expiring',
			context: {
				subject,
				bankName,
				bankConnectionsUrl,
				consentEndsOn: formatDateTime(connection.consentValidUntil as Date),
			},
		};
	}

	private describeSyncProblem(connection: BankConnection): string {
		if (connection.status === BANK_CONNECTION_STATUSES.EXPIRED) {
			return `The access you gave Tempo to ${connection.aspspName} has ended.`;
		}
		if (connection.syncStatus === BANK_SYNC_STATUSES.RATE_LIMITED) {
			return `${connection.aspspName} is limiting how often Tempo can fetch data.`;
		}
		return 'Recent sync attempts did not succeed.';
	}
}

/** The marker value an alert is raised for: the consent end date, or the last success (creation if none). */
function alertEpisode(
	connection: Pick<BankConnectionAlertState, 'consentValidUntil' | 'createdAt' | 'lastSuccessfulSyncAt'>,
	alert: BankConnectionAlert,
): Date {
	return alert === BANK_CONNECTION_ALERTS.SYNC_BROKEN
		? (connection.lastSuccessfulSyncAt ?? connection.createdAt)
		: (connection.consentValidUntil as Date);
}

function formatDateTime(value: Date): string {
	return `${dateTimeFormat.format(value)} UTC`;
}
