import {BullModule} from '@nestjs/bullmq';
import {Module} from '@nestjs/common';
import {TypeOrmModule} from '@nestjs/typeorm';

import {MERCHANT_LOGO_QUEUE} from '@core/queue/queue.constants';
import {RedisModule} from '@core/redis/redis.module';

import {BankTransaction} from '../bank-transaction.entity';
import {BankTransactionCategorizationModule} from '../categorization/bank-transaction-categorization.module';
import {LogoDevClient} from './logo-dev.client';
import {MerchantLogoMaskService} from './merchant-logo-mask.service';
import {MerchantLogoController} from './merchant-logo.controller';
import {MerchantLogo} from './merchant-logo.entity';
import {MerchantLogoProcessor} from './merchant-logo.processor';
import {MerchantLogoService} from './merchant-logo.service';
import {MerchantSiteFetcher} from './merchant-site-fetcher';
import {Merchant} from './merchant.entity';

@Module({
	imports: [
		RedisModule,
		BullModule.registerQueue({name: MERCHANT_LOGO_QUEUE}),
		TypeOrmModule.forFeature([Merchant, MerchantLogo, BankTransaction]),
		BankTransactionCategorizationModule,
	],
	providers: [
		MerchantLogoService,
		MerchantLogoMaskService,
		MerchantLogoProcessor,
		LogoDevClient,
		{provide: MerchantSiteFetcher, useFactory: () => new MerchantSiteFetcher()},
	],
	controllers: [MerchantLogoController],
	exports: [MerchantLogoService],
})
export class MerchantLogoModule {}
