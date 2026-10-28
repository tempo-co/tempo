import {BullModule} from '@nestjs/bullmq';
import {Module} from '@nestjs/common';
import {TypeOrmModule} from '@nestjs/typeorm';

import {MERCHANT_LOGO_QUEUE} from '@core/queue/queue.constants';

import {BankTransaction} from '../bank-transaction.entity';
import {BankTransactionCategorizationModule} from '../categorization/bank-transaction-categorization.module';
import {LogoDevClient} from './logo-dev.client';
import {MerchantLogoController} from './merchant-logo.controller';
import {MerchantLogo} from './merchant-logo.entity';
import {MerchantLogoProcessor} from './merchant-logo.processor';
import {MerchantLogoService} from './merchant-logo.service';
import {MerchantSiteFetcher} from './merchant-site-fetcher';
import {Merchant} from './merchant.entity';

@Module({
	imports: [
		BullModule.registerQueue({name: MERCHANT_LOGO_QUEUE}),
		TypeOrmModule.forFeature([Merchant, MerchantLogo, BankTransaction]),
		BankTransactionCategorizationModule,
	],
	providers: [
		MerchantLogoService,
		MerchantLogoProcessor,
		LogoDevClient,
		{provide: MerchantSiteFetcher, useFactory: () => new MerchantSiteFetcher()},
	],
	controllers: [MerchantLogoController],
	exports: [MerchantLogoService],
})
export class MerchantLogoModule {}
