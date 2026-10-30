import {Module} from '@nestjs/common';
import {APP_GUARD} from '@nestjs/core';
import {PassportModule} from '@nestjs/passport';

import {EmailModule} from '@core/email/email.module';
import {PersonalAccessTokenModule} from '@core/personal-access-token/personal-access-token.module';
import {RedisModule} from '@core/redis/redis.module';
import {SessionModule} from '@core/session/session.module';
import {AccountModule} from '@modules/account/account.module';

import {AuthController} from './api/auth.controller';
import {PersonalAccessTokenController} from './api/personal-access-token.controller';
import {AuthGuard} from './guards/auth.guard';
import {CsrfOriginGuard} from './guards/csrf-origin.guard';
import {AuthService} from './services/auth.service';
import {EmailVerifierService} from './services/email-verifier.service';
import {PasswordResetService} from './services/password-reset.service';
import {SessionSerializer} from './services/session.serializer';
import {LocalStrategy} from './strategies/local.strategy';

@Module({
	imports: [
		RedisModule,
		AccountModule,
		EmailModule,
		SessionModule,
		PersonalAccessTokenModule,
		PassportModule.register({session: true}),
	],
	providers: [
		AuthService,
		CsrfOriginGuard,
		EmailVerifierService,
		PasswordResetService,
		SessionSerializer,
		LocalStrategy,
		{provide: APP_GUARD, useClass: AuthGuard},
	],
	controllers: [AuthController, PersonalAccessTokenController],
})
export class AuthModule {}
