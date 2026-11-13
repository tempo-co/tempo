import {Processor, WorkerHost} from '@nestjs/bullmq';
import {Job} from 'bullmq';

import {ConfigurationService} from '@core/config/config.service';
import {
	BACKFILL_BANK_TRANSACTION_AMOUNTS_JOB,
	BANK_TRANSACTION_AMOUNT_CONVERSION_JOB,
	BANK_TRANSACTION_AMOUNT_CONVERSION_QUEUE,
	RECOMPUTE_OWN_TRANSFERS_JOB,
} from '@core/queue/queue.constants';

import {RecurringSeriesService} from '../recurring/recurring-series.service';
import {BankTransactionAmountConversionJobData} from './bank-transaction-amount-conversion.queue.service';
import {BankTransactionAmountConversionService} from './bank-transaction-amount-conversion.service';
import {OwnTransferService} from './own-transfer.service';

/** Owner-wide derived amounts and classifications, one job at a time. */
@Processor(BANK_TRANSACTION_AMOUNT_CONVERSION_QUEUE, {concurrency: 1})
export class BankTransactionAmountConversionProcessor extends WorkerHost {
	constructor(
		private readonly conversionService: BankTransactionAmountConversionService,
		private readonly configurationService: ConfigurationService,
		private readonly ownTransferService: OwnTransferService,
		private readonly recurringSeriesService: RecurringSeriesService,
	) {
		super();
	}

	async process(job: Job<BankTransactionAmountConversionJobData>): Promise<void> {
		if (!this.configurationService.get('BANKING_INTEGRATION_ENABLED')) return;
		if (job.name === RECOMPUTE_OWN_TRANSFERS_JOB) {
			await this.ownTransferService.recomputeAllOwners();
			// After the recompute, so its own change notes are folded too.
			await this.recurringSeriesService.foldAllChangeNotes();
			return;
		}
		if (job.name !== BACKFILL_BANK_TRANSACTION_AMOUNTS_JOB && job.name !== BANK_TRANSACTION_AMOUNT_CONVERSION_JOB) {
			return;
		}
		await this.conversionService.backfill();
	}
}
