import {Logger} from '@nestjs/common';

import {bootstrapJobScheduler} from './job-scheduler';

const JOB = {schedulerId: 'example-scheduler', jobName: 'example-job', everyMs: 60_000};

function setup(nodeEnv = 'production') {
	const queue = {
		upsertJobScheduler: jest.fn().mockResolvedValue({}),
		removeJobScheduler: jest.fn().mockResolvedValue(true),
	};
	const configurationService = {get: jest.fn((key: string) => (key === 'NODE_ENV' ? nodeEnv : undefined))};
	const logger = {warn: jest.fn()};
	const bootstrap = (enabled: boolean) =>
		bootstrapJobScheduler(queue as never, JOB, {
			enabled,
			configurationService: configurationService as never,
			logger: logger as unknown as Logger,
		});
	return {queue, logger, bootstrap};
}

describe('bootstrapJobScheduler', () => {
	it('installs a single-attempt repeating job when the feature is on', async () => {
		const {queue, bootstrap} = setup();

		await expect(bootstrap(true)).resolves.toBe(true);

		expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
			'example-scheduler',
			{every: 60_000},
			{
				name: 'example-job',
				data: {},
				opts: {attempts: 1, removeOnComplete: true, removeOnFail: {age: 86_400, count: 100}},
			},
		);
		expect(queue.removeJobScheduler).not.toHaveBeenCalled();
	});

	it('removes the scheduler when the feature is off', async () => {
		const {queue, bootstrap} = setup();

		await expect(bootstrap(false)).resolves.toBe(false);

		expect(queue.removeJobScheduler).toHaveBeenCalledWith('example-scheduler');
		expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
	});

	it('leaves Redis untouched in tests', async () => {
		const {queue, bootstrap} = setup('test');

		await expect(bootstrap(true)).resolves.toBe(false);

		expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
		expect(queue.removeJobScheduler).not.toHaveBeenCalled();
	});

	it.each([
		{enabled: true, method: 'upsertJobScheduler', action: 'installed'},
		{enabled: false, method: 'removeJobScheduler', action: 'removed'},
	] as const)(
		'logs the error name and lets boot continue when it cannot be $action',
		async ({enabled, method, action}) => {
			const {queue, logger, bootstrap} = setup();
			queue[method].mockRejectedValue(new TypeError('connect ECONNREFUSED example.ts.net'));

			await expect(bootstrap(enabled)).resolves.toBe(false);

			expect(logger.warn).toHaveBeenCalledWith(
				`Job scheduler example-scheduler could not be ${action}: TypeError`,
			);
		},
	);
});
