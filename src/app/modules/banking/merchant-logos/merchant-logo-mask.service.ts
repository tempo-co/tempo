import {Inject, Injectable, NotFoundException} from '@nestjs/common';
import Redis from 'ioredis';
import {createHash} from 'node:crypto';

import {REDIS} from '@core/redis/redis.constants';

import {MERCHANT_LOGO_NOT_FOUND} from '../api/constants/banking-messages.constants';
import {MERCHANT_LOGO_MASK_VERSION, createMerchantLogoMask} from './merchant-logo-mask';

const PREFIX = `merchant-logo:${MERCHANT_LOGO_MASK_VERSION}:`;
const INDEX = `${PREFIX}index`;
const TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_ENTRIES = 256;

// Atomically bound the cache across API processes. FIFO scores use Redis's clock, not a caller's clock.
// The index outlives every entry it tracks; both disappear when no new masks are written for one TTL.
const STORE_MASK = `
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
local now = redis.call('TIME')
redis.call('ZADD', KEYS[2], now[1] * 1000000 + now[2], KEYS[1])
local overflow = redis.call('ZCARD', KEYS[2]) - tonumber(ARGV[3])
if overflow > 0 then
 local oldest = redis.call('ZRANGE', KEYS[2], 0, overflow - 1)
 for _, key in ipairs(oldest) do
  redis.call('DEL', key)
  redis.call('ZREM', KEYS[2], key)
 end
end
redis.call('EXPIRE', KEYS[2], ARGV[2])
return 1
`;

/** Shared derivative bytes, never an authorization boundary. The controller checks the source first. */
@Injectable()
export class MerchantLogoMaskService {
	private readonly inFlight = new Map<string, Promise<Buffer>>();

	constructor(@Inject(REDIS) private readonly redis: Redis) {}

	async getImage(original: Buffer): Promise<Buffer> {
		const key = PREFIX + createHash('sha256').update(original).digest('hex');
		const existing = this.inFlight.get(key);
		if (existing) return existing;
		const conversion = this.loadOrCreate(key, original);
		this.inFlight.set(key, conversion);
		try {
			return await conversion;
		} finally {
			this.inFlight.delete(key);
		}
	}

	private async loadOrCreate(key: string, original: Buffer): Promise<Buffer> {
		const cached = await this.redis.getBuffer(key);
		if (cached) return cached;
		const image = await createMerchantLogoMask(original);
		if (!image) throw new NotFoundException(MERCHANT_LOGO_NOT_FOUND);
		await this.redis.eval(STORE_MASK, 2, key, INDEX, image, TTL_SECONDS, MAX_ENTRIES);
		return image;
	}
}
