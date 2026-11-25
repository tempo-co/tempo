import {Controller, Get, Inject} from '@nestjs/common';
import {HealthCheck, HealthCheckService, HealthIndicatorService, TypeOrmHealthIndicator} from '@nestjs/terminus';
import Redis from 'ioredis';

import {REDIS} from '@core/redis/redis.constants';
import {Public} from '@modules/auth/decorators/public.decorator';

/** The client queues commands while Redis is down instead of failing them, so a ping gets a deadline. */
const REDIS_PING_TIMEOUT_MS = 2_000;

@Controller('health')
export class HealthController {
	constructor(
		private health: HealthCheckService,
		private db: TypeOrmHealthIndicator,
		private indicators: HealthIndicatorService,
		@Inject(REDIS) private readonly redis: Redis,
	) {}

	@Get()
	@Public()
	@HealthCheck()
	async check() {
		return await this.health.check([
			() => ({api: {status: 'up'}}),
			() => this.db.pingCheck('database'),
			() => this.redisCheck(),
		]);
	}

	private async redisCheck() {
		const indicator = this.indicators.check('redis');
		let timer: NodeJS.Timeout | undefined;
		const deadline = new Promise<never>((_resolve, reject) => {
			timer = setTimeout(() => reject(new Error('timeout')), REDIS_PING_TIMEOUT_MS);
		});
		try {
			await Promise.race([this.redis.ping(), deadline]);
			return indicator.up();
		} catch {
			return indicator.down();
		} finally {
			clearTimeout(timer);
		}
	}
}
