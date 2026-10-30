import {Inject, Injectable, OnModuleDestroy} from '@nestjs/common';
import Redis from 'ioredis';

import {REDIS} from './redis.constants';

@Injectable()
export class RedisService implements OnModuleDestroy {
	constructor(@Inject(REDIS) private readonly client: Redis) {}

	/** Quits gracefully when shutdown hooks fire. */
	async onModuleDestroy() {
		this.client.quit();
	}
}
