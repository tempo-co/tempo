import {Processor, WorkerHost} from '@nestjs/bullmq';
import {Job} from 'bullmq';

import {
	APPLY_MANUAL_CATEGORY_TO_MERCHANT_JOB,
	BANK_TRANSACTION_CATEGORIZATION_QUEUE,
	CATEGORIZE_BANK_TRANSACTIONS_JOB,
	RECONCILE_BANK_TRANSACTION_CATEGORIZATION_JOB,
} from '@core/queue/queue.constants';

import {CategorizationPipeline} from './categorization-pipeline.service';
import {
	BankTransactionCategorizationJobData,
	BankTransactionCategorizationQueueData,
	CategorizationScheduler,
	ManualCategoryFollowUpJobData,
	categorizationRetryDelay,
} from './categorization-scheduler.service';
import {ManualCategoryService} from './manual-category.service';

@Processor(BANK_TRANSACTION_CATEGORIZATION_QUEUE, {
	concurrency: 1,
	settings: {backoffStrategy: (attemptsMade, _type, error) => categorizationRetryDelay(attemptsMade, error)},
})
export class BankTransactionCategorizationProcessor extends WorkerHost {
	constructor(
		private readonly pipeline: CategorizationPipeline,
		private readonly manualCategoryService: ManualCategoryService,
		private readonly scheduler: CategorizationScheduler,
	) {
		super();
	}

	async process(job: Job<BankTransactionCategorizationQueueData>): Promise<void> {
		switch (job.name) {
			case CATEGORIZE_BANK_TRANSACTIONS_JOB:
				await this.pipeline.processTransactionJob(
					(job.data as BankTransactionCategorizationJobData).transactionIds,
				);
				return;
			case APPLY_MANUAL_CATEGORY_TO_MERCHANT_JOB:
				await this.manualCategoryService.processManualCategoryFollowUp(
					job.data as ManualCategoryFollowUpJobData,
				);
				return;
			case RECONCILE_BANK_TRANSACTION_CATEGORIZATION_JOB:
				await this.scheduler.reconcilePendingTransactions({includeFailed: false});
				return;
		}
	}
}
