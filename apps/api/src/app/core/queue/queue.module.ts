import {BullModule} from '@nestjs/bullmq';
import {Global, Module} from '@nestjs/common';

import {ConfigurationService} from '@core/config/config.service';
import {RedisModule} from '@core/redis/redis.module';

@Global()
@Module({
	imports: [
		RedisModule,
		BullModule.forRootAsync({
			imports: [RedisModule],
			inject: [ConfigurationService],
			useFactory: async (config: ConfigurationService) => ({
				connection: {
					url: config.get('REDIS_URL'),
					maxRetriesPerRequest: null,
					enableReadyCheck: true,
				},
				defaultJobOptions: {
					attempts: 3,
					backoff: {type: 'exponential', delay: 1000},
					removeOnComplete: true,
					removeOnFail: {age: 86400, count: 500},
				},
			}),
		}),
	],
	exports: [BullModule],
})
export class QueueModule {}
