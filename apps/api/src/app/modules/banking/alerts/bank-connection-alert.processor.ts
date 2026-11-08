import {Processor, WorkerHost} from '@nestjs/bullmq';
import {Job} from 'bullmq';

import {
	BANK_CONNECTION_ALERT_QUEUE,
	SCAN_BANK_CONNECTION_ALERTS_JOB,
	SCAN_RECURRING_BILL_ALERTS_JOB,
} from '@core/queue/queue.constants';

import {BankConnectionAlertService} from './bank-connection-alert.service';
import {RecurringBillAlertService} from './recurring-bill-alert.service';

@Processor(BANK_CONNECTION_ALERT_QUEUE)
export class BankConnectionAlertProcessor extends WorkerHost {
	constructor(
		private readonly bankConnectionAlertService: BankConnectionAlertService,
		private readonly recurringBillAlertService: RecurringBillAlertService,
	) {
		super();
	}

	async process(job: Job): Promise<void> {
		if (job.name === SCAN_BANK_CONNECTION_ALERTS_JOB) await this.bankConnectionAlertService.scan();
		if (job.name === SCAN_RECURRING_BILL_ALERTS_JOB) await this.recurringBillAlertService.scan();
	}
}
