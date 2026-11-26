import {Processor, WorkerHost} from '@nestjs/bullmq';
import {Job} from 'bullmq';

import {BANK_COVERAGE_DIGEST_QUEUE, SEND_BANK_COVERAGE_DIGEST_JOB} from '@core/queue/queue.constants';

import {BankCoverageDigestService} from './bank-coverage-digest.service';

@Processor(BANK_COVERAGE_DIGEST_QUEUE)
export class BankCoverageDigestProcessor extends WorkerHost {
	constructor(private readonly bankCoverageDigestService: BankCoverageDigestService) {
		super();
	}

	async process(job: Job): Promise<void> {
		if (job.name !== SEND_BANK_COVERAGE_DIGEST_JOB) return;
		await this.bankCoverageDigestService.send();
	}
}
