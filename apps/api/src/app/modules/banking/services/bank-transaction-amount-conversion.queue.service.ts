import {InjectQueue} from '@nestjs/bullmq';
import {Injectable, Logger, OnModuleInit} from '@nestjs/common';
import {Queue} from 'bullmq';

import {ConfigurationService} from '@core/config/config.service';
import {bootstrapJobScheduler} from '@core/queue/job-scheduler';
import {
	BACKFILL_BANK_TRANSACTION_AMOUNTS_JOB,
	BANK_TRANSACTION_AMOUNT_CONVERSION_JOB,
	BANK_TRANSACTION_AMOUNT_CONVERSION_QUEUE,
	BANK_TRANSACTION_AMOUNT_CONVERSION_SCHEDULER_ID,
} from '@core/queue/queue.constants';

import {safeErrorName} from '../banking.utils';

export type BankTransactionAmountConversionJobData = Record<string, never>;

// Bumped when a migration clears stored amounts, so they reconvert on deploy instead of on the next tick.
const BACKFILL_JOB_ID = 'bank-transaction-amount-backfill-v2';
const CONVERSION_INTERVAL_MS = 15 * 60 * 1000;

@Injectable()
export class BankTransactionAmountConversionQueueService implements OnModuleInit {
	private readonly logger = new Logger(BankTransactionAmountConversionQueueService.name);

	constructor(
		@InjectQueue(BANK_TRANSACTION_AMOUNT_CONVERSION_QUEUE)
		private readonly queue: Queue<BankTransactionAmountConversionJobData>,
		private readonly configurationService: ConfigurationService,
	) {}

	async onModuleInit(): Promise<void> {
		const enabled = Boolean(this.configurationService.get('BANKING_INTEGRATION_ENABLED'));
		await bootstrapJobScheduler(
			this.queue,
			{
				schedulerId: BANK_TRANSACTION_AMOUNT_CONVERSION_SCHEDULER_ID,
				jobName: BANK_TRANSACTION_AMOUNT_CONVERSION_JOB,
				everyMs: CONVERSION_INTERVAL_MS,
			},
			{
				enabled,
				configurationService: this.configurationService,
				logger: this.logger,
			},
		);
		if (!enabled || this.configurationService.get('NODE_ENV') === 'test') return;
		try {
			await this.enqueueBackfill();
		} catch (error) {
			// The 15-minute conversion run picks up the same rows.
			this.logger.warn(`FX backfill enqueue failed: ${safeErrorName(error)}`);
		}
	}

	private async enqueueBackfill(): Promise<void> {
		const existingBackfill = await this.queue.getJob(BACKFILL_JOB_ID);
		let shouldEnqueueBackfill = !existingBackfill;
		if (existingBackfill && (await existingBackfill.getState()) === 'failed') {
			await existingBackfill.remove();
			shouldEnqueueBackfill = true;
		}
		if (shouldEnqueueBackfill) {
			await this.queue.add(
				BACKFILL_BANK_TRANSACTION_AMOUNTS_JOB,
				{},
				{jobId: BACKFILL_JOB_ID, attempts: 3, removeOnComplete: false, removeOnFail: {age: 86_400, count: 10}},
			);
		}
	}
}
