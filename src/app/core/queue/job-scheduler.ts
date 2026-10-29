import {Logger} from '@nestjs/common';
import {Queue} from 'bullmq';

import {ConfigurationService} from '@core/config/config.service';

export type RepeatingJob = {
	schedulerId: string;
	jobName: string;
	everyMs: number;
};

type BootstrapJobSchedulerOptions = {
	enabled: boolean;
	configurationService: ConfigurationService;
	logger: Logger;
};

/**
 * Installs a repeating job's scheduler on boot, or removes it when its feature is off; tests run without schedulers.
 * A Redis failure is logged and boot continues: the scheduler left by the previous boot keeps running, and every
 * scheduled job checks that its feature is on before doing any work. Resolves true when the scheduler is installed.
 */
export async function bootstrapJobScheduler(
	queue: Queue,
	{schedulerId, jobName, everyMs}: RepeatingJob,
	{enabled, configurationService, logger}: BootstrapJobSchedulerOptions,
): Promise<boolean> {
	if (configurationService.get('NODE_ENV') === 'test') return false;
	try {
		if (!enabled) {
			await queue.removeJobScheduler(schedulerId);
			return false;
		}
		await queue.upsertJobScheduler(
			schedulerId,
			{every: everyMs},
			{
				name: jobName,
				data: {},
				opts: {attempts: 1, removeOnComplete: true, removeOnFail: {age: 86_400, count: 100}},
			},
		);
		return true;
	} catch (error) {
		const errorName = error instanceof Error && error.name.length > 0 ? error.name : 'UnknownError';
		logger.warn(`Job scheduler ${schedulerId} could not be ${enabled ? 'installed' : 'removed'}: ${errorName}`);
		return false;
	}
}
