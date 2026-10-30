import {MailerService} from '@nestjs-modules/mailer';
import {Job} from 'bullmq';

import {EmailProcessor} from './email.processor';
import {EmailJobData} from './email.service';

describe('EmailProcessor', () => {
	it('does not pass queue account metadata to the mailer', async () => {
		const mailerService = {sendMail: jest.fn().mockResolvedValue(undefined)};
		const processor = new EmailProcessor(mailerService as unknown as MailerService);
		const job = {
			data: {
				to: 'account@test.com',
				subject: 'Subject',
				accountId: 'account-id',
			},
		} as Job<EmailJobData>;

		await processor.process(job);

		expect(mailerService.sendMail).toHaveBeenCalledWith({to: 'account@test.com', subject: 'Subject'});
	});
});
