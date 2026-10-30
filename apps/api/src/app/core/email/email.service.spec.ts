import {Queue} from 'bullmq';

import {SEND_EMAIL_JOB} from '@core/queue/queue.constants';

import {EmailService} from './email.service';

describe('EmailService', () => {
	it('tags queued email jobs with their account ID', async () => {
		const emailQueue = {add: jest.fn().mockResolvedValue(undefined)};
		const service = new EmailService(emailQueue as unknown as Queue);

		await service.send({to: 'account@test.com', subject: 'Subject'}, 'account-id');

		expect(emailQueue.add).toHaveBeenCalledWith(
			SEND_EMAIL_JOB,
			{to: 'account@test.com', subject: 'Subject', accountId: 'account-id'},
			undefined,
		);
	});

	it('retains jobs with a stable ID for idempotent enqueue retries', async () => {
		const emailQueue = {add: jest.fn().mockResolvedValue(undefined)};
		const service = new EmailService(emailQueue as unknown as Queue);

		await service.send({to: 'user@example.test', subject: 'Subject'}, 'account-id', 'alert-episode-id');

		expect(emailQueue.add).toHaveBeenCalledWith(
			SEND_EMAIL_JOB,
			{to: 'user@example.test', subject: 'Subject', accountId: 'account-id'},
			{jobId: 'alert-episode-id', removeOnComplete: {age: 604_800}, removeOnFail: {age: 604_800}},
		);
	});

	it('removes pending and retained jobs only for the requested account', async () => {
		const ownedJob = {data: {accountId: 'account-id'}, remove: jest.fn().mockResolvedValue(undefined)};
		const otherJob = {data: {accountId: 'other-account'}, remove: jest.fn().mockResolvedValue(undefined)};
		const emailQueue = {
			add: jest.fn(),
			getJobs: jest.fn().mockResolvedValue([ownedJob, otherJob]),
		};
		const service = new EmailService(emailQueue as unknown as Queue);

		await service.cancelPendingForAccount('account-id');

		expect(emailQueue.getJobs).toHaveBeenCalledWith(['waiting', 'delayed', 'completed', 'failed']);
		expect(ownedJob.remove).toHaveBeenCalledTimes(1);
		expect(otherJob.remove).not.toHaveBeenCalled();
	});
});
