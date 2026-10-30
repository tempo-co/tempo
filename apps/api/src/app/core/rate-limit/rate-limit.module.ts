import {ThrottlerStorageRedisService} from '@nest-lab/throttler-storage-redis';
import {Module} from '@nestjs/common';
import {ThrottlerModule, ThrottlerModuleOptions, ThrottlerOptions} from '@nestjs/throttler';
import Redis from 'ioredis';
import ms from 'ms';

import {ConfigurationService} from '@core/config/config.service';
import {REDIS} from '@core/redis/redis.constants';
import {RedisModule} from '@core/redis/redis.module';

/** Name of the throttler used in the test environment; route-level `@Throttle` metadata does not apply to named throttlers. */
export const TEST_THROTTLER_NAME = 'test';

/**
 * Builds the throttler options for the rate limit module.
 *
 * The test environment registers its limits under a named throttler so that route-level `@Throttle`
 * metadata (tuned for production) is ignored and test suites stay deterministic; the limits still
 * come from `THROTTLE_TTL`/`THROTTLE_LIMIT`, and the in-memory default storage keeps tests
 * independent of Redis.
 */
export function throttlerOptions(
	config: Pick<ConfigurationService, 'get'>,
	redisClient: Redis,
): Extract<ThrottlerModuleOptions, {throttlers: ThrottlerOptions[]}> {
	const isTest = config.get('NODE_ENV') === 'test';
	const throttlers = [
		{
			...(isTest && {name: TEST_THROTTLER_NAME}),
			ttl: ms(config.get('THROTTLE_TTL') as ms.StringValue),
			limit: config.get('THROTTLE_LIMIT'),
		},
	];

	if (isTest) return {throttlers};
	return {throttlers, storage: new ThrottlerStorageRedisService(redisClient)};
}

@Module({
	imports: [
		RedisModule,
		ThrottlerModule.forRootAsync({
			imports: [RedisModule],
			inject: [ConfigurationService, REDIS],
			useFactory: throttlerOptions,
		}),
	],
})
export class RateLimitModule {}
