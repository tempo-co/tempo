import {MailerService} from '@nestjs-modules/mailer';
import {Processor, WorkerHost} from '@nestjs/bullmq';
import {Job} from 'bullmq';

import {EMAIL_QUEUE} from '@core/queue/queue.constants';

import type {EmailJobData} from './email.service';

@Processor(EMAIL_QUEUE)
export class EmailProcessor extends WorkerHost {
	constructor(private readonly mailerService: MailerService) {
		super();
	}

	async process(job: Job<EmailJobData>) {
		const mailOptions = {...job.data};
		delete mailOptions.accountId;
		await this.mailerService.sendMail(mailOptions);
	}
}
