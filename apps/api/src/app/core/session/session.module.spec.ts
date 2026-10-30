import {MiddlewareConsumer} from '@nestjs/common';
import {RedisStore} from 'connect-redis';
import Redis from 'ioredis';

import {ConfigurationService} from '@core/config/config.service';

import {SessionMiddleware} from './session.middleware';
import {SessionModule} from './session.module';
import {SessionService} from './session.service';

jest.mock('connect-redis', () => ({
	RedisStore: jest.fn().mockImplementation((options: {client: Redis; prefix?: string}) => ({
		on: jest.fn(),
		prefix: options.prefix,
	})),
}));

describe('SessionModule', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('uses the configured Redis prefix for session storage', async () => {
		const redisClient = {} as Redis;
		const configValues = {
			NODE_ENV: 'test',
			SESSION_SECRET: 'test-secret',
			SESSION_EXPIRATION: '7d',
			SESSION_REDIS_KEY: 'tempo:session',
		};
		const config = {
			get: jest.fn((key: keyof typeof configValues) => configValues[key]),
		} as unknown as ConfigurationService;
		const forRoutes = jest.fn();
		const consumer = {
			apply: jest.fn().mockReturnValue({forRoutes}),
		} as unknown as MiddlewareConsumer;

		const sessionMiddleware = new SessionMiddleware({} as SessionService);
		await new SessionModule(redisClient, config, sessionMiddleware).configure(consumer);

		expect(RedisStore).toHaveBeenCalledWith({client: redisClient, prefix: 'tempo:session:', disableTouch: true});
		expect(forRoutes).toHaveBeenCalledWith('*');
	});
});
