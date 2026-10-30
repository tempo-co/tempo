import {Processor, WorkerHost} from '@nestjs/bullmq';
import {Job} from 'bullmq';

import {BANK_CONNECTION_ALERT_QUEUE, SCAN_BANK_CONNECTION_ALERTS_JOB} from '@core/queue/queue.constants';

import {BankConnectionAlertService} from './bank-connection-alert.service';

@Processor(BANK_CONNECTION_ALERT_QUEUE)
export class BankConnectionAlertProcessor extends WorkerHost {
	constructor(private readonly bankConnectionAlertService: BankConnectionAlertService) {
		super();
	}

	async process(job: Job): Promise<void> {
		if (job.name !== SCAN_BANK_CONNECTION_ALERTS_JOB) return;
		await this.bankConnectionAlertService.scan();
	}
}
