import {Processor, WorkerHost} from '@nestjs/bullmq';
import {InjectRepository} from '@nestjs/typeorm';
import {Job} from 'bullmq';
import {Repository} from 'typeorm';

import {
	BANK_CONNECTION_SYNC_QUEUE,
	DISPATCH_BANK_CONNECTION_SYNCS_JOB,
	SYNC_BANK_CONNECTION_JOB,
} from '@core/queue/queue.constants';

import {BankConnection} from '../bank-connection.entity';
import {BankConnectionSyncJobData, BankingSyncQueueService} from './banking-sync-queue.service';
import {BankingSyncService} from './banking-sync.service';

@Processor(BANK_CONNECTION_SYNC_QUEUE, {concurrency: 5})
export class BankingSyncProcessor extends WorkerHost {
	constructor(
		@InjectRepository(BankConnection)
		private readonly bankConnectionRepository: Repository<BankConnection>,
		private readonly bankingSyncService: BankingSyncService,
		private readonly bankingSyncQueueService: BankingSyncQueueService,
	) {
		super();
	}

	async process(job: Job<BankConnectionSyncJobData>): Promise<void> {
		if (!this.bankingSyncQueueService.isIntegrationEnabled()) return;
		if (job.name === DISPATCH_BANK_CONNECTION_SYNCS_JOB) {
			await this.bankingSyncQueueService.dispatchDueConnections();
			return;
		}
		if (job.name !== SYNC_BANK_CONNECTION_JOB) return;

		const connectionId = job.data.connectionId;
		if (!connectionId) return;

		const connection = await this.bankConnectionRepository.findOne({where: {id: connectionId}});
		if (!connection || !this.bankingSyncQueueService.isSynchronizationDue(connection)) return;

		await this.bankingSyncService.synchronizeAutomatically(connection.id);
	}
}
