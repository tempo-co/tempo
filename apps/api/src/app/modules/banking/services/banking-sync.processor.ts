import {Processor, WorkerHost} from '@nestjs/bullmq';
import {InjectRepository} from '@nestjs/typeorm';
import {Job} from 'bullmq';
import {Repository} from 'typeorm';

import {OperatorAlertService} from '@core/operator-alert/operator-alert.service';
import {
	BANK_CONNECTION_SYNC_QUEUE,
	DISPATCH_BANK_CONNECTION_SYNCS_JOB,
	SYNC_BANK_CONNECTION_JOB,
} from '@core/queue/queue.constants';

import {BankConnection} from '../bank-connection.entity';
import {safeErrorName} from '../banking.utils';
import {BankConnectionSyncJobData, BankingSyncQueueService} from './banking-sync-queue.service';
import {BankingSyncService} from './banking-sync.service';

@Processor(BANK_CONNECTION_SYNC_QUEUE, {concurrency: 5})
export class BankingSyncProcessor extends WorkerHost {
	constructor(
		@InjectRepository(BankConnection)
		private readonly bankConnectionRepository: Repository<BankConnection>,
		private readonly bankingSyncService: BankingSyncService,
		private readonly bankingSyncQueueService: BankingSyncQueueService,
		private readonly operatorAlertService: OperatorAlertService,
	) {
		super();
	}

	async process(job: Job<BankConnectionSyncJobData>): Promise<void> {
		if (!this.bankingSyncQueueService.isIntegrationEnabled()) return;
		if (job.name === DISPATCH_BANK_CONNECTION_SYNCS_JOB) {
			await this.dispatchScheduledRun();
			return;
		}
		if (job.name !== SYNC_BANK_CONNECTION_JOB) return;

		const connectionId = job.data.connectionId;
		if (!connectionId) return;

		const connection = await this.bankConnectionRepository.findOne({where: {id: connectionId}});
		if (!connection || !this.bankingSyncQueueService.isSynchronizationDue(connection)) return;

		await this.bankingSyncService.synchronizeAutomatically(connection.id);
	}

	/** A connection's own failure stays with that connection; a run that fails as a whole reaches the operator. */
	private async dispatchScheduledRun(): Promise<void> {
		try {
			await this.bankingSyncQueueService.dispatchDueConnections();
		} catch (error) {
			const errorName = safeErrorName(error);
			await this.operatorAlertService.send({
				kind: `bank-sync-run-${errorName}`,
				subject: 'Wisp: scheduled bank sync failed',
				text: [
					`The scheduled bank sync run failed with ${errorName}, so no bank connection was synced.`,
					'Check the API log.',
				].join('\n\n'),
			});
			throw error;
		}
	}
}
