import {InjectQueue} from '@nestjs/bullmq';
import {Injectable, Logger, OnModuleInit} from '@nestjs/common';
import {InjectRepository} from '@nestjs/typeorm';
import {Queue} from 'bullmq';
import {LessThanOrEqual, Not, Repository} from 'typeorm';

import {ConfigurationService} from '@core/config/config.service';
import {bootstrapJobScheduler} from '@core/queue/job-scheduler';
import {
	BANK_CONNECTION_SYNC_QUEUE,
	BANK_CONNECTION_SYNC_SCHEDULER_ID,
	DISPATCH_BANK_CONNECTION_SYNCS_JOB,
	SYNC_BANK_CONNECTION_JOB,
} from '@core/queue/queue.constants';

import {BankConnection} from '../bank-connection.entity';
import {safeErrorName} from '../banking.utils';
import {BankingConnectionLockService} from './banking-connection-lock.service';
import {BANK_CONNECTION_STATUSES, BANK_SYNC_STATUSES, resolveDurationMs} from './banking-sync.constants';

export type BankConnectionSyncJobData = {
	connectionId?: string;
};

const MAX_DISPATCH_BATCH = 100;
const ACTIVE_JOB_STATES = new Set(['active', 'delayed', 'prioritized', 'waiting', 'waiting-children']);

@Injectable()
export class BankingSyncQueueService implements OnModuleInit {
	private readonly logger = new Logger(BankingSyncQueueService.name);
	private readonly bankingIntegrationEnabled: boolean;

	constructor(
		@InjectRepository(BankConnection)
		private readonly bankConnectionRepository: Repository<BankConnection>,
		@InjectQueue(BANK_CONNECTION_SYNC_QUEUE)
		private readonly queue: Queue<BankConnectionSyncJobData>,
		private readonly configurationService: ConfigurationService,
		private readonly connectionLockService: BankingConnectionLockService,
	) {
		this.bankingIntegrationEnabled = configurationService.get('BANKING_INTEGRATION_ENABLED') !== false;
	}

	isIntegrationEnabled(): boolean {
		return this.bankingIntegrationEnabled;
	}

	async onModuleInit(): Promise<void> {
		await bootstrapJobScheduler(
			this.queue,
			{
				schedulerId: BANK_CONNECTION_SYNC_SCHEDULER_ID,
				jobName: DISPATCH_BANK_CONNECTION_SYNCS_JOB,
				everyMs: this.getDispatchIntervalMs(),
			},
			{
				enabled: this.bankingIntegrationEnabled,
				configurationService: this.configurationService,
				logger: this.logger,
			},
		);
	}

	async enqueueInitialSync(connectionId: BankConnection['id']): Promise<void> {
		if (!this.bankingIntegrationEnabled) return;
		await this.enqueueConnectionSync(connectionId, true);
	}

	async dispatchDueConnections(now = new Date()): Promise<number> {
		if (!this.bankingIntegrationEnabled) return 0;
		const staleBefore = new Date(now.getTime() - this.getRunningTimeoutMs());
		const connections = await this.bankConnectionRepository
			.createQueryBuilder('connection')
			.where('connection.status = :status', {status: BANK_CONNECTION_STATUSES.AUTHORIZED})
			.andWhere(
				'(connection.nextSyncAt <= :now OR (connection.syncStatus = :running AND connection.syncStartedAt <= :staleBefore))',
				{now, running: BANK_SYNC_STATUSES.RUNNING, staleBefore},
			)
			.orderBy('connection.nextSyncAt', 'ASC')
			.addOrderBy('connection.id', 'ASC')
			.take(MAX_DISPATCH_BATCH)
			.getMany();
		let enqueued = 0;

		for (const connection of connections) {
			// One connection's Redis or database error must not stop the others from being dispatched.
			try {
				if (await this.dispatchConnection(connection, now, staleBefore)) enqueued += 1;
			} catch (error) {
				this.logger.warn(
					`Automatic bank synchronization for ${connection.id} could not be queued: ${safeErrorName(error)}`,
				);
			}
		}

		return enqueued;
	}

	private async dispatchConnection(connection: BankConnection, now: Date, staleBefore: Date): Promise<boolean> {
		if (!this.isSynchronizationDue(connection, now)) return false;
		const running = connection.syncStatus === BANK_SYNC_STATUSES.RUNNING;
		if (running && (await this.connectionLockService.isHeld(connection.id))) return false;
		// A job that is already waiting or running owns the connection; the row keeps the state that job sets.
		if (await this.hasLiveJob(connection.id)) return false;

		// QUEUED is written before the job exists, so a worker that picks the job up at once never sees the old row.
		const updateResult = await this.bankConnectionRepository.update(
			running
				? {
						id: connection.id,
						status: BANK_CONNECTION_STATUSES.AUTHORIZED,
						syncStatus: BANK_SYNC_STATUSES.RUNNING,
						syncStartedAt: LessThanOrEqual(staleBefore),
					}
				: {
						id: connection.id,
						status: BANK_CONNECTION_STATUSES.AUTHORIZED,
						nextSyncAt: LessThanOrEqual(now),
						syncStatus: Not(BANK_SYNC_STATUSES.RUNNING),
					},
			{
				nextSyncAt: running ? now : connection.nextSyncAt,
				syncStatus: BANK_SYNC_STATUSES.QUEUED,
			},
		);
		if (updateResult.affected !== 1) return false;
		// If adding fails, the row stays QUEUED and due, so the next dispatch tries again.
		await this.addSyncJob(connection.id, false);
		return true;
	}

	public isSynchronizationDue(connection: BankConnection, now = new Date()): boolean {
		if (connection.status !== BANK_CONNECTION_STATUSES.AUTHORIZED) return false;
		const due = connection.nextSyncAt !== null && connection.nextSyncAt.getTime() <= now.getTime();
		if (connection.syncStatus !== BANK_SYNC_STATUSES.RUNNING) return due;

		const staleBefore = new Date(now.getTime() - this.getRunningTimeoutMs());
		return connection.syncStartedAt !== null && connection.syncStartedAt.getTime() <= staleBefore.getTime();
	}

	private async enqueueConnectionSync(connectionId: string, initial: boolean): Promise<void> {
		if (!this.bankingIntegrationEnabled) return;
		if (await this.hasLiveJob(connectionId)) return;
		await this.addSyncJob(connectionId, initial);
	}

	/** Whether a waiting or running job exists for the connection; a finished or failed one is removed. */
	private async hasLiveJob(connectionId: string): Promise<boolean> {
		const existingJob = await this.queue.getJob(this.getJobId(connectionId));
		if (!existingJob) return false;
		const state = await existingJob.getState();
		if (ACTIVE_JOB_STATES.has(state)) return true;
		await existingJob.remove();
		return false;
	}

	private async addSyncJob(connectionId: string, initial: boolean): Promise<void> {
		await this.queue.add(
			SYNC_BANK_CONNECTION_JOB,
			{connectionId},
			{
				jobId: this.getJobId(connectionId),
				priority: initial ? 1 : 10,
				attempts: 1,
				removeOnComplete: true,
				removeOnFail: {age: 86_400, count: 500},
			},
		);
		this.logger.debug(`Queued automatic bank synchronization for ${connectionId}.`);
	}

	private getJobId(connectionId: string): string {
		return `bank-connection-sync-${connectionId}`;
	}

	private getRunningTimeoutMs(): number {
		return resolveDurationMs(
			this.configurationService.get('BANKING_SYNC_RUNNING_TIMEOUT'),
			'BANKING_SYNC_RUNNING_TIMEOUT',
		);
	}

	private getDispatchIntervalMs(): number {
		return resolveDurationMs(
			this.configurationService.get('BANKING_SYNC_DISPATCH_INTERVAL'),
			'BANKING_SYNC_DISPATCH_INTERVAL',
		);
	}
}
