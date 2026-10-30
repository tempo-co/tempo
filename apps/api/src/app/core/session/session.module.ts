import {Inject, MiddlewareConsumer, Module, NestModule} from '@nestjs/common';
import {NextFunction, Request, Response} from 'express';
import session from 'express-session';
import Redis from 'ioredis';
import ms from 'ms';
import passport from 'passport';

import {ConfigurationService} from '@core/config/config.service';
import {isBearerRequest} from '@core/personal-access-token/bearer-request';
import {isMcpRequest} from '@core/personal-access-token/mcp-request';
import {PersonalAccessTokenModule} from '@core/personal-access-token/personal-access-token.module';
import {REDIS} from '@core/redis/redis.constants';
import {RedisModule} from '@core/redis/redis.module';
import {RevocationSafeRedisStore} from '@core/session/revocation-safe-redis.store';
import {SessionMiddleware} from '@core/session/session.middleware';
import {SessionService} from '@core/session/session.service';

@Module({
	imports: [RedisModule, PersonalAccessTokenModule],
	providers: [SessionService, SessionMiddleware],
	exports: [SessionService],
})
export class SessionModule implements NestModule {
	constructor(
		@Inject(REDIS) private readonly redisClient: Redis,
		private readonly config: ConfigurationService,
		private readonly sessionMiddleware: SessionMiddleware,
	) {}

	async configure(consumer: MiddlewareConsumer) {
		const isProduction = this.config.get('NODE_ENV') === 'production';

		const sessionOnly =
			(middleware: (req: Request, res: Response, next: NextFunction) => unknown) =>
			(req: Request, res: Response, next: NextFunction) =>
				isMcpRequest(req) || isBearerRequest(req) ? next() : middleware(req, res, next);

		consumer
			.apply(
				sessionOnly(
					session({
						store: new RevocationSafeRedisStore(
							this.redisClient,
							`${this.config.get('SESSION_REDIS_KEY')}:`,
						),
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
				),
				sessionOnly(passport.initialize()),
				sessionOnly(passport.session()),
				sessionOnly(this.sessionMiddleware.use.bind(this.sessionMiddleware)),
			)
			.forRoutes('*');
	}
}
