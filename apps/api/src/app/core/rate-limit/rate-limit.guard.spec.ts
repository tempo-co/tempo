import {ThrottlerStorageRedisService} from '@nest-lab/throttler-storage-redis';
import {ExecutionContext, HttpException, HttpStatus} from '@nestjs/common';
import {Reflector} from '@nestjs/core';
import {
	Throttle,
	ThrottlerGuard,
	ThrottlerRequest,
	ThrottlerStorage,
	seconds,
	throttlerMessage,
} from '@nestjs/throttler';
import Redis from 'ioredis';
import ms from 'ms';

import {Config} from '@core/config/config.schema';
import {ConfigurationService} from '@core/config/config.service';

import {TEST_THROTTLER_NAME, throttlerOptions} from './rate-limit.module';

const THROTTLE_TTL = '1h';
const THROTTLE_LIMIT = 1000;
const CLIENT_IP = '203.0.113.10';
const redisClient = new Redis({lazyConnect: true});

afterAll(() => {
	redisClient.disconnect();
});

type ThrottleConfigKey = 'NODE_ENV' | 'THROTTLE_TTL' | 'THROTTLE_LIMIT';

function createConfig(values: Partial<Pick<Config, ThrottleConfigKey>> = {}): ConfigurationService {
	const config: Pick<Config, ThrottleConfigKey> = {NODE_ENV: 'test', THROTTLE_TTL, THROTTLE_LIMIT, ...values};
	return {get: (key: ThrottleConfigKey) => config[key]} as unknown as ConfigurationService;
}

function createContext(options: {ip?: string; handler?: () => unknown} = {}): ExecutionContext {
	const handler = options.handler ?? (() => undefined);
	return {
		switchToHttp: () => ({
			getRequest: () => ({ip: options.ip ?? CLIENT_IP, headers: {}}),
			getResponse: () => ({header: jest.fn()}),
		}),
		getHandler: () => handler,
		getClass: () => class RateLimitSpecController {},
	} as unknown as ExecutionContext;
}

describe('throttlerOptions', () => {
	it('keeps the throttler enabled in the test environment under a named throttler without redis storage', () => {
		const options = throttlerOptions(createConfig(), redisClient);

		expect(options).toEqual({
			throttlers: [{name: TEST_THROTTLER_NAME, ttl: ms(THROTTLE_TTL), limit: THROTTLE_LIMIT}],
		});
		expect(options.storage).toBeUndefined();
	});

	it('applies the configured ttl and limit', () => {
		const options = throttlerOptions(createConfig({THROTTLE_TTL: '10m', THROTTLE_LIMIT: 42}), redisClient);

		expect(options).toEqual({throttlers: [{name: TEST_THROTTLER_NAME, ttl: ms('10m'), limit: 42}]});
	});

	it('uses the redis storage and an unnamed throttler outside the test environment', () => {
		const options = throttlerOptions(createConfig({NODE_ENV: 'production'}), redisClient);

		const storage = options.storage as ThrottlerStorageRedisService;
		expect(storage).toBeInstanceOf(ThrottlerStorageRedisService);
		expect((storage as unknown as {redis: Redis}).redis).toBe(redisClient);
		expect(options.throttlers).toEqual([{ttl: ms(THROTTLE_TTL), limit: THROTTLE_LIMIT}]);
	});
});

describe('ThrottlerGuard with the test throttler', () => {
	let storage: {increment: jest.Mock};

	beforeEach(() => {
		storage = {increment: jest.fn()};
	});

	async function createGuard(options = throttlerOptions(createConfig(), redisClient)) {
		const guard = new ThrottlerGuard(options, storage as unknown as ThrottlerStorage, new Reflector());
		await guard.onModuleInit();
		return guard;
	}

	it('lets requests within the limit pass and counts them against the configured ttl and limit', async () => {
		storage.increment.mockResolvedValue({
			totalHits: 1,
			timeToExpire: ms(THROTTLE_TTL) / 1000,
			isBlocked: false,
			timeToBlockExpire: 0,
		});
		const guard = await createGuard();

		await expect(guard.canActivate(createContext())).resolves.toBe(true);

		expect(storage.increment).toHaveBeenCalledTimes(1);
		const [key, ttl, limit, blockDuration, throttlerName] = storage.increment.mock.calls[0];
		expect(typeof key).toBe('string');
		expect(ttl).toBe(ms(THROTTLE_TTL));
		expect(limit).toBe(THROTTLE_LIMIT);
		expect(blockDuration).toBe(ms(THROTTLE_TTL));
		expect(throttlerName).toBe(TEST_THROTTLER_NAME);
	});

	it('throws a 429 throttling exception when the limit is exceeded', async () => {
		storage.increment.mockResolvedValue({
			totalHits: THROTTLE_LIMIT + 1,
			timeToExpire: 1,
			isBlocked: true,
			timeToBlockExpire: ms(THROTTLE_TTL) / 1000,
		});
		const guard = await createGuard();

		const error = await guard.canActivate(createContext()).catch((exception: HttpException) => exception);

		expect(error).toBeInstanceOf(HttpException);
		expect((error as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
		expect((error as HttpException).message).toBe(throttlerMessage);
	});

	it('honors per-route metadata declared for the test throttler', async () => {
		const handler = () => undefined;
		Throttle({[TEST_THROTTLER_NAME]: {limit: 2, ttl: seconds(30)}})(handler);
		storage.increment.mockResolvedValue({totalHits: 3, timeToExpire: 29, isBlocked: true, timeToBlockExpire: 30});
		const guard = await createGuard();

		await guard.canActivate(createContext({handler})).catch((exception: HttpException) => exception);

		const [key, ttl, limit] = storage.increment.mock.calls[0];
		expect(limit).toBe(2);
		expect(ttl).toBe(seconds(30));
		expect(typeof key).toBe('string');
	});

	it('tracks requests per client ip', async () => {
		storage.increment.mockResolvedValue({totalHits: 1, timeToExpire: 1, isBlocked: false, timeToBlockExpire: 0});
		const guard = await createGuard();

		await guard.canActivate(createContext({ip: '198.51.100.7'}));
		await guard.canActivate(createContext({ip: '198.51.100.8'}));
		await guard.canActivate(createContext({ip: '198.51.100.7'}));

		const [firstKey] = storage.increment.mock.calls[0];
		const [secondKey] = storage.increment.mock.calls[1];
		const [thirdKey] = storage.increment.mock.calls[2];
		expect(firstKey).toMatch(/^[0-9a-f]{64}$/);
		expect(secondKey).not.toBe(firstKey);
		expect(thirdKey).toBe(firstKey);
	});

	it('supports subclasses overriding the per-request limit', async () => {
		class LimitedThrottlerGuard extends ThrottlerGuard {
			protected handleRequest(request: ThrottlerRequest) {
				request.limit = 3;
				return super.handleRequest(request);
			}
		}
		storage.increment.mockResolvedValue({
			totalHits: 4,
			timeToExpire: 1,
			isBlocked: true,
			timeToBlockExpire: ms(THROTTLE_TTL) / 1000,
		});
		const guard = new LimitedThrottlerGuard(
			throttlerOptions(createConfig(), redisClient),
			storage as unknown as ThrottlerStorage,
			new Reflector(),
		);
		await guard.onModuleInit();

		const error = await guard.canActivate(createContext()).catch((exception: HttpException) => exception);

		expect(error).toBeInstanceOf(HttpException);
		expect((error as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
		expect(storage.increment.mock.calls[0][2]).toBe(3);
	});
});
