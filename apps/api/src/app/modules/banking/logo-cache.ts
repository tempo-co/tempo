import Redis from 'ioredis';

const TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_ENTRIES = 256;
// Atomic FIFO eviction uses Redis's clock and bounds each derivative family across API processes.
const STORE_IMAGE = `
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

/** Shared successful derivative bytes. Callers own source lookup and access checks. */
export class LogoCache {
	private readonly inFlight = new Map<string, Promise<Buffer>>();
	constructor(private readonly redis: Redis) {}

	async getOrCreate(prefix: string, version: string, create: () => Promise<Buffer>): Promise<Buffer> {
		const key = prefix + version;
		const pending = this.inFlight.get(key);
		if (pending) return pending;
		const work = this.loadOrCreate(prefix, key, create);
		this.inFlight.set(key, work);
		try {
			return await work;
		} finally {
			this.inFlight.delete(key);
		}
	}

	private async loadOrCreate(prefix: string, key: string, create: () => Promise<Buffer>) {
		const cached = await this.redis.getBuffer(key);
		if (cached) return cached;
		const bytes = await create();
		await this.redis.eval(STORE_IMAGE, 2, key, `${prefix}index`, bytes, TTL_SECONDS, MAX_ENTRIES);
		return bytes;
	}
}
