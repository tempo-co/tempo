import {Inject, MiddlewareConsumer, Module, NestModule} from '@nestjs/common';
import session from 'express-session';
import Redis from 'ioredis';
import ms from 'ms';
import passport from 'passport';

import {ConfigurationService} from '@core/config/config.service';
import {REDIS} from '@core/redis/redis.constants';
import {RedisModule} from '@core/redis/redis.module';
import {RevocationSafeRedisStore} from '@core/session/revocation-safe-redis.store';
import {SessionMiddleware} from '@core/session/session.middleware';
import {SessionService} from '@core/session/session.service';

@Module({
	imports: [RedisModule],
	providers: [SessionService],
	exports: [SessionService],
})
export class SessionModule implements NestModule {
	constructor(
		@Inject(REDIS) private readonly redisClient: Redis,
		private readonly config: ConfigurationService,
	) {}

	async configure(consumer: MiddlewareConsumer) {
		const isProduction = this.config.get('NODE_ENV') === 'production';

		consumer
			.apply(
				session({
					store: new RevocationSafeRedisStore(this.redisClient, `${this.config.get('SESSION_REDIS_KEY')}:`),
					name: this.config.get('SESSION_COOKIE_NAME'),
					secret: this.config.get('SESSION_SECRET'),
					resave: false,
					saveUninitialized: false,
					cookie: {
						path: this.config.get('SESSION_COOKIE_PATH'),
						secure: isProduction,
						httpOnly: true,
						sameSite: 'strict',
						maxAge: ms(this.config.get('SESSION_EXPIRATION') as ms.StringValue),
					},
				}),
				passport.initialize(),
				passport.session(),
				SessionMiddleware,
			)
			.forRoutes('*');
	}
}
