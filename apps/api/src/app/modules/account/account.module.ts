import {Module} from '@nestjs/common';
import {TypeOrmModule} from '@nestjs/typeorm';

import {EmailModule} from '@core/email/email.module';
import {RedisModule} from '@core/redis/redis.module';
import {SessionModule} from '@core/session/session.module';
import {BankConnection} from '@modules/banking/bank-connection.entity';
import {BankingAuthorizationStateModule} from '@modules/banking/services/banking-authorization-state.module';
import {BankingConsentRevocationModule} from '@modules/banking/services/banking-consent-revocation.module';

import {AccountDeletionService} from './account-deletion.service';
import {Account} from './account.entity';
import {AccountService} from './account.service';
import {AccountController} from './api/account.controller';

@Module({
	imports: [
		TypeOrmModule.forFeature([Account, BankConnection]),
		EmailModule,
		RedisModule,
		SessionModule,
		BankingAuthorizationStateModule,
		BankingConsentRevocationModule,
	],
	providers: [AccountService, AccountDeletionService],
	controllers: [AccountController],
	exports: [AccountService],
})
export class AccountModule {}
