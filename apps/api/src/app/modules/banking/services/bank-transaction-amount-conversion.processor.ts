import {Processor, WorkerHost} from '@nestjs/bullmq';
import {Job} from 'bullmq';

import {ConfigurationService} from '@core/config/config.service';
import {
	BACKFILL_BANK_TRANSACTION_AMOUNTS_JOB,
	BANK_TRANSACTION_AMOUNT_CONVERSION_JOB,
	BANK_TRANSACTION_AMOUNT_CONVERSION_QUEUE,
} from '@core/queue/queue.constants';

import {BankTransactionAmountConversionJobData} from './bank-transaction-amount-conversion.queue.service';
import {BankTransactionAmountConversionService} from './bank-transaction-amount-conversion.service';

@Processor(BANK_TRANSACTION_AMOUNT_CONVERSION_QUEUE, {concurrency: 1})
export class BankTransactionAmountConversionProcessor extends WorkerHost {
	constructor(
		private readonly conversionService: BankTransactionAmountConversionService,
		private readonly configurationService: ConfigurationService,
	) {
		super();
	}

	async process(job: Job<BankTransactionAmountConversionJobData>): Promise<void> {
		if (!this.configurationService.get('BANKING_INTEGRATION_ENABLED')) return;
		if (job.name !== BACKFILL_BANK_TRANSACTION_AMOUNTS_JOB && job.name !== BANK_TRANSACTION_AMOUNT_CONVERSION_JOB) {
			return;
		}
		await this.conversionService.backfill();
	}
}
