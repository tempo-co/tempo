import {ISendMailOptions} from '@nestjs-modules/mailer';
import {InjectQueue} from '@nestjs/bullmq';
import {Injectable} from '@nestjs/common';
import {Queue} from 'bullmq';

import {EMAIL_QUEUE, SEND_EMAIL_JOB} from '@core/queue/queue.constants';

export type EmailJobData = ISendMailOptions & {accountId?: string};

const IDEMPOTENT_JOB_RETENTION = {age: 7 * 24 * 60 * 60};

@Injectable()
export class EmailService {
	constructor(@InjectQueue(EMAIL_QUEUE) private readonly emailQueue: Queue<EmailJobData>) {}

	async send(options: ISendMailOptions, accountId: string, jobId?: string) {
		// Retain idempotent jobs for a week so retries after a database rollback cannot queue the same email again.
		await this.emailQueue.add(
			SEND_EMAIL_JOB,
			{...options, accountId},
			jobId
				? {jobId, removeOnComplete: IDEMPOTENT_JOB_RETENTION, removeOnFail: IDEMPOTENT_JOB_RETENTION}
				: undefined,
		);
	}

	async cancelPendingForAccount(accountId: string) {
		const jobs = await this.emailQueue.getJobs(['waiting', 'delayed', 'completed', 'failed']);
		await Promise.all(jobs.filter((job) => job.data.accountId === accountId).map((job) => job.remove()));
	}
}
