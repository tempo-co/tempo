import {Module} from '@nestjs/common';

import {RedisModule} from '@core/redis/redis.module';

import {BankingAuthorizationStateService} from './banking-authorization-state.service';

@Module({
	imports: [RedisModule],
	providers: [BankingAuthorizationStateService],
	exports: [BankingAuthorizationStateService],
})
export class BankingAuthorizationStateModule {}
