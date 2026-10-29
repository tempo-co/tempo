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
			if (!this.isSynchronizationDue(connection, now)) continue;
			if (
				connection.syncStatus === BANK_SYNC_STATUSES.RUNNING &&
				(await this.connectionLockService.isHeld(connection.id))
			) {
				continue;
			}

			await this.enqueueConnectionSync(connection.id, false);

			const updateWhere =
				connection.syncStatus === BANK_SYNC_STATUSES.RUNNING
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
						};
			const updateResult = await this.bankConnectionRepository.update(updateWhere, {
				nextSyncAt: connection.syncStatus === BANK_SYNC_STATUSES.RUNNING ? now : connection.nextSyncAt,
				syncStatus: BANK_SYNC_STATUSES.QUEUED,
			});
			if (updateResult.affected !== 1) continue;
			enqueued += 1;
		}

		return enqueued;
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
		const jobId = this.getJobId(connectionId);
		const existingJob = await this.queue.getJob(jobId);
		if (existingJob) {
			const state = await existingJob.getState();
			if (ACTIVE_JOB_STATES.has(state)) return;
			await existingJob.remove();
		}

		await this.queue.add(
			SYNC_BANK_CONNECTION_JOB,
			{connectionId},
			{
				jobId,
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
