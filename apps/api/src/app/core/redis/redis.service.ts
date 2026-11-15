import {Inject, Injectable, OnModuleDestroy} from '@nestjs/common';
import Redis from 'ioredis';

import {REDIS} from './redis.constants';

@Injectable()
export class RedisService implements OnModuleDestroy {
	constructor(@Inject(REDIS) private readonly client: Redis) {}

	/** Quits gracefully when shutdown hooks fire, so shutdown waits until Redis has replied. */
	async onModuleDestroy() {
		// While Redis is unreachable, QUIT would wait behind queued commands that never run; drop the connection instead.
		if (this.client.status === 'ready') await this.client.quit();
		else this.client.disconnect();
	}
}
