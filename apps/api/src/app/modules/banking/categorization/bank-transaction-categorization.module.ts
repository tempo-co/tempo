import {BullModule} from '@nestjs/bullmq';
import {Module} from '@nestjs/common';
import {TypeOrmModule} from '@nestjs/typeorm';

import {EmailModule} from '@core/email/email.module';
import {BANK_TRANSACTION_CATEGORIZATION_QUEUE} from '@core/queue/queue.constants';
import {RedisModule} from '@core/redis/redis.module';

import {BankTransaction} from '../bank-transaction.entity';
import {AnthropicCreditAlert} from './anthropic-credit-alert.service';
import {BankTransactionCategorizationProcessor} from './bank-transaction-categorization.processor';
import {BANK_TRANSACTION_CATEGORIZATION_PROVIDER} from './bank-transaction-categorization.provider';
import {CategorizationContextLoader} from './categorization-context-loader.service';
import {CategorizationPipeline} from './categorization-pipeline.service';
import {CategorizationRowStore} from './categorization-row-store.service';
import {CategorizationScheduler} from './categorization-scheduler.service';
import {ManualCategoryService} from './manual-category.service';
import {ClaudeBankTransactionCategorizationProvider} from './providers/claude-bank-transaction-categorization.provider';

@Module({
	imports: [
		BullModule.registerQueue({name: BANK_TRANSACTION_CATEGORIZATION_QUEUE}),
		TypeOrmModule.forFeature([BankTransaction]),
		EmailModule,
		RedisModule,
	],
	providers: [
		AnthropicCreditAlert,
		ClaudeBankTransactionCategorizationProvider,
		{provide: BANK_TRANSACTION_CATEGORIZATION_PROVIDER, useExisting: ClaudeBankTransactionCategorizationProvider},
		CategorizationScheduler,
		CategorizationRowStore,
		CategorizationContextLoader,
		ManualCategoryService,
		CategorizationPipeline,
		BankTransactionCategorizationProcessor,
	],
	exports: [CategorizationScheduler, ManualCategoryService, ClaudeBankTransactionCategorizationProvider],
})
export class BankTransactionCategorizationModule {}
